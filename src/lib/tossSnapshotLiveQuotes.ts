import type { TossTestHolding, TossTestSnapshot } from "../api";
import type { PicksDailyHistoryQuotesMap } from "../types";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./netReturn";
import {
  computeTossAccountCombinedPnl,
  tossHoldingsNetReturnPct,
} from "./tossHoldingPnl";

function pickTossQuote(
  quotes: PicksDailyHistoryQuotesMap,
  h: TossTestHolding,
): PicksDailyHistoryQuotesMap[string] | undefined {
  const raw = h.symbol.trim().toUpperCase();
  const direct = quotes[raw];
  if (direct?.price != null && Number.isFinite(direct.price) && direct.price > 0) {
    return direct;
  }
  const bare = raw.replace(/\.(KS|KQ)$/i, "");
  if (bare !== raw) {
    const hit = quotes[bare];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) return hit;
  }
  if (h.market === "kr" && /^\d{6}$/.test(bare)) {
    const ks = `${bare}.KS`;
    const hit = quotes[ks];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) return hit;
  }
  return undefined;
}

/** 보유 매입·평가 합산 총수익률(%) — USD는 환율로 원화 환산 */
export function tossHoldingsReturnPct(
  holdings: TossTestHolding[],
  usdKrwRate: number | null,
): number | null {
  let costKrw = 0;
  let mktKrw = 0;

  for (const h of holdings) {
    const avg = h.avgBuyPrice;
    const qty = h.quantity;
    if (avg == null || !(avg > 0) || !(qty > 0)) continue;

    const cost = avg * qty;
    const mv =
      h.marketValue != null && Number.isFinite(h.marketValue) && h.marketValue > 0
        ? h.marketValue
        : h.currentPrice != null &&
            Number.isFinite(h.currentPrice) &&
            h.currentPrice > 0
          ? h.currentPrice * qty
          : null;
    if (mv == null) continue;

    if (h.currency === "USD") {
      if (!(usdKrwRate != null && usdKrwRate > 0)) continue;
      costKrw += cost * usdKrwRate;
      mktKrw += mv * usdKrwRate;
    } else {
      costKrw += cost;
      mktKrw += mv;
    }
  }

  if (!(costKrw > 0)) return null;
  const pct = ((mktKrw - costKrw) / costKrw) * 100;
  return Number.isFinite(pct) ? pct : null;
}

function holdingUnrealized(h: TossTestHolding, price: number): number | null {
  if (!(h.avgBuyPrice != null && h.avgBuyPrice > 0 && Number.isFinite(h.avgBuyPrice))) {
    return null;
  }
  const mv = price * h.quantity;
  const cost = h.avgBuyPrice * h.quantity;
  const unreal = mv - cost;
  return Number.isFinite(unreal) ? unreal : null;
}

/** 토스 보유 스냅샷에 1분봉 시세를 반영하고 평가 손익을 재계산 */
export function mergeLiveQuotesIntoTossSnapshot(
  snapshot: TossTestSnapshot,
  quotes: PicksDailyHistoryQuotesMap,
  usdKrwRate: number | null,
): TossTestSnapshot {
  if (!snapshot.holdings?.length) return snapshot;

  let plKrw = 0;
  let plUsd = 0;
  let hasKrwPl = false;
  let hasUsdPl = false;
  let anyLive = false;

  const holdings = snapshot.holdings.map((h) => {
    const quote = pickTossQuote(quotes, h);
    const price = quote?.price;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      const unreal =
        h.marketValue != null && h.avgBuyPrice != null && h.avgBuyPrice > 0
          ? h.marketValue - h.avgBuyPrice * h.quantity
          : null;
      if (unreal != null && Number.isFinite(unreal)) {
        if (h.currency === "USD") {
          plUsd += unreal;
          hasUsdPl = true;
        } else {
          plKrw += unreal;
          hasKrwPl = true;
        }
      }
      return h;
    }

    anyLive = true;
    const mv = price * h.quantity;
    let returnPercent: number | null = null;
    if (h.avgBuyPrice != null && h.avgBuyPrice > 0) {
      returnPercent = ((price - h.avgBuyPrice) / h.avgBuyPrice) * 100;
      if (!Number.isFinite(returnPercent)) returnPercent = null;
    }
    const unreal = holdingUnrealized(h, price);
    if (unreal != null) {
      if (h.currency === "USD") {
        plUsd += unreal;
        hasUsdPl = true;
      } else {
        plKrw += unreal;
        hasKrwPl = true;
      }
    }

    return {
      ...h,
      currentPrice: price,
      marketValue: mv,
      returnPercent,
      dailyChangePercent:
        quote?.changePercent != null && Number.isFinite(quote.changePercent)
          ? quote.changePercent
          : h.dailyChangePercent,
    };
  });

  const roundTripFee = normalizeRoundTripFeeRate(DEFAULT_ROUND_TRIP_FEE_RATE);
  const combined = computeTossAccountCombinedPnl(
    holdings,
    snapshot.summary,
    usdKrwRate,
    roundTripFee,
  );
  const totalReturnPct =
    combined.totalReturnPct ??
    tossHoldingsNetReturnPct(holdings, usdKrwRate, roundTripFee);

  if (!anyLive && !hasKrwPl && !hasUsdPl) {
    if (totalReturnPct == null && combined.profitLossKrw == null) return snapshot;
    return {
      ...snapshot,
      summary: {
        ...snapshot.summary,
        profitLossKrw: combined.profitLossKrw ?? snapshot.summary?.profitLossKrw,
        totalReturnPct,
      },
    };
  }

  let profitLossKrw = combined.profitLossKrw;
  if (profitLossKrw == null && (hasKrwPl || hasUsdPl)) {
    if (hasUsdPl && usdKrwRate != null && usdKrwRate > 0) {
      profitLossKrw = (hasKrwPl ? plKrw : 0) + plUsd * usdKrwRate;
    } else if (hasKrwPl && !hasUsdPl) {
      profitLossKrw = plKrw;
    }
  }

  return {
    ...snapshot,
    holdings,
    summary: {
      ...snapshot.summary,
      profitLossKrw: profitLossKrw ?? snapshot.summary?.profitLossKrw,
      profitLossUsd: hasUsdPl ? plUsd : snapshot.summary?.profitLossUsd,
      totalReturnPct,
    },
  };
}

export function tossSnapshotSymbolKey(snapshot: TossTestSnapshot | null): string {
  return (
    snapshot?.holdings
      .map((h) => h.symbol.trim().toUpperCase())
      .sort()
      .join(",") ?? ""
  );
}

/** 잔고·수량 갱신 시 1분봉 시세·손익 표시는 유지 */
export function mergeTossLedgerPreserveLiveQuotes(
  ledger: TossTestSnapshot,
  live: TossTestSnapshot,
): TossTestSnapshot {
  const symKeyL = tossSnapshotSymbolKey(ledger);
  const symKeyLive = tossSnapshotSymbolKey(live);
  if (!symKeyL || symKeyL !== symKeyLive) return ledger;

  const liveByKey = new Map(
    live.holdings.map((h) => [`${h.market}:${h.symbol.trim().toUpperCase()}`, h]),
  );

  const holdings = ledger.holdings.map((h) => {
    const p = liveByKey.get(`${h.market}:${h.symbol.trim().toUpperCase()}`);
    const price = p?.currentPrice;
    if (price == null || !Number.isFinite(price) || price <= 0) return h;

    const mv = price * h.quantity;
    let returnPercent: number | null = p.returnPercent ?? null;
    if (h.avgBuyPrice != null && h.avgBuyPrice > 0) {
      returnPercent = ((price - h.avgBuyPrice) / h.avgBuyPrice) * 100;
      if (!Number.isFinite(returnPercent)) returnPercent = null;
    }

    return {
      ...h,
      currentPrice: price,
      marketValue: mv,
      returnPercent,
      dailyChangePercent: p.dailyChangePercent ?? h.dailyChangePercent,
    };
  });

  return { ...ledger, holdings };
}

/** 동일 잔고·보유면 setState 생략용 */
export function tossSnapshotLedgerFingerprint(snapshot: TossTestSnapshot): string {
  return JSON.stringify({
    krw: snapshot.cash?.krw,
    usd: snapshot.cash?.usd,
    holdings: snapshot.holdings.map((h) => ({
      k: `${h.market}:${h.symbol.trim().toUpperCase()}`,
      q: h.quantity,
      a: h.avgBuyPrice,
    })),
  });
}
