import type {
  LiveTradeHolding,
  LiveTradePortfolioResponse,
  LiveTradeRecord,
  PicksDailyHistoryQuotesMap,
} from "../api";
import { ROUND_TRIP_FEE_RATE } from "./netReturn";

function pickQuote(
  quotes: PicksDailyHistoryQuotesMap,
  symbol: string,
  market: "kr" | "us" | "crypto",
) {
  const raw = symbol.trim().toUpperCase();
  const direct = quotes[raw];
  if (direct?.price != null && Number.isFinite(direct.price) && direct.price > 0) {
    return direct;
  }
  if (market === "crypto") return null;
  const norm =
    market === "kr" && /^\d{6}$/.test(raw) && !/\.(KS|KQ)$/i.test(raw)
      ? `${raw}.KS`
      : raw;
  if (norm !== raw) {
    const hit = quotes[norm];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) {
      return hit;
    }
  }
  const bare = raw.replace(/\.(KS|KQ)$/i, "");
  if (bare !== raw) {
    const hit = quotes[bare];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) {
      return hit;
    }
  }
  return null;
}

function closedCostFromTrades(trades: LiveTradeRecord[]): number {
  return trades
    .filter((t) => t.side === "sell")
    .reduce((s, t) => s + t.amount, 0);
}

function applyQuoteToHolding(
  h: LiveTradeHolding,
  price: number,
  quote?: PicksDailyHistoryQuotesMap[string],
): LiveTradeHolding {
  const avgEntry = h.avgEntryPrice;
  const mv = price * h.quantity;
  const unrealized = mv - h.costBasis;
  const grossPct =
    avgEntry > 0 ? ((price - avgEntry) / avgEntry) * 100 : null;
  const netPct =
    avgEntry > 0
      ? (price / avgEntry) * (1 - ROUND_TRIP_FEE_RATE) * 100 - 100
      : null;
  const quotedAtMs =
    quote?.quotedAtMs != null && Number.isFinite(quote.quotedAtMs)
      ? quote.quotedAtMs
      : null;
  return {
    ...h,
    currentPrice: price,
    marketValue: mv,
    unrealizedPnl: unrealized,
    grossChangePct: grossPct,
    changePct: netPct,
    quoteQuotedAtMs: quotedAtMs,
    priceSource:
      quote?.priceSource === "over" ||
      quote?.priceSource === "regular" ||
      quote?.priceSource === "1m"
        ? quote.priceSource
        : quote?.interval === "over" || quote?.interval === "regular"
          ? (quote.interval as "over" | "regular")
          : quote?.interval === "1m"
            ? "1m"
            : null,
  };
}

/** 포트폴리오 스냅샷에서 심볼별 최신 폴링 시세만 추출 */
export function extractQuotesFromPortfolio(
  snap: LiveTradePortfolioResponse,
): PicksDailyHistoryQuotesMap {
  const out: PicksDailyHistoryQuotesMap = {};
  for (const h of snap.holdings) {
    const sym = h.symbol.trim().toUpperCase();
    if (h.currentPrice == null || !Number.isFinite(h.currentPrice)) continue;
    out[sym] = {
      price: h.currentPrice,
      changePercent:
        h.grossChangePct != null && Number.isFinite(h.grossChangePct)
          ? h.grossChangePct
          : undefined,
      currency: h.currency,
    };
  }
  return out;
}

/** 1분봉 스냅샷으로 보유·요약 시세만 갱신 (서버 포트폴리오 재조회 없음) */
export function mergeLiveQuotesIntoPortfolio(
  snap: LiveTradePortfolioResponse,
  quotes: PicksDailyHistoryQuotesMap,
): LiveTradePortfolioResponse {
  let investedOpen = 0;
  let marketValueOpen = 0;

  const holdings = snap.holdings.map((h) => {
    const q = pickQuote(quotes, h.symbol, h.market);
    const px = q?.price;
    const next =
      px != null && Number.isFinite(px) && px > 0
        ? applyQuoteToHolding(h, px, q ?? undefined)
        : h;
    investedOpen += next.costBasis;
    if (next.marketValue != null) marketValueOpen += next.marketValue;
    return next;
  });

  const unrealizedPnl = marketValueOpen - investedOpen;
  const realizedPnl = snap.summary.realizedPnl;
  const totalPnl = realizedPnl + unrealizedPnl;
  const closedCost = closedCostFromTrades(snap.trades);
  const denom = investedOpen + closedCost;
  let totalReturnPct: number | null =
    denom > 0
      ? (totalPnl / denom) * 100
      : investedOpen > 0
        ? (unrealizedPnl / investedOpen) * 100
        : null;
  if (totalReturnPct != null && !Number.isFinite(totalReturnPct)) {
    totalReturnPct = null;
  }

  return {
    ...snap,
    updatedAtMs: Date.now(),
    summary: {
      ...snap.summary,
      holdingCount: holdings.length,
      investedOpen,
      marketValueOpen,
      unrealizedPnl,
      totalPnl,
      totalReturnPct,
    },
    holdings,
  };
}
