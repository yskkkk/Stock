import type { TossTestHolding, TossTestSnapshot } from "../api";
import type { PicksDailyHistoryQuotesMap } from "../types";

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

  if (!anyLive && !hasKrwPl && !hasUsdPl) return snapshot;

  let profitLossKrw = snapshot.summary?.profitLossKrw ?? null;
  if (hasKrwPl || hasUsdPl) {
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
      profitLossKrw,
      profitLossUsd: hasUsdPl ? plUsd : snapshot.summary?.profitLossUsd,
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
