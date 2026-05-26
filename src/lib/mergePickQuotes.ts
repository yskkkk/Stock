import type { PicksDailyHistoryQuotesMap } from "../api";
import type { PicksResponse, StockPick } from "../types";

function mergeOnePick(pick: StockPick, quotes: PicksDailyHistoryQuotesMap): StockPick {
  const sym = pick.symbol.trim().toUpperCase();
  const q = quotes[sym];
  if (!q?.price || !Number.isFinite(q.price)) return pick;
  return {
    ...pick,
    price: q.price,
    changePercent:
      q.changePercent != null && Number.isFinite(q.changePercent)
        ? q.changePercent
        : pick.changePercent,
    currency: q.currency ?? pick.currency,
  };
}

export function mergeQuotesIntoPicks(
  picks: PicksResponse,
  quotes: PicksDailyHistoryQuotesMap,
): PicksResponse {
  if (!quotes || !Object.keys(quotes).length) return picks;
  return {
    ...picks,
    kr: picks.kr.map((p) => mergeOnePick(p, quotes)),
    us: picks.us.map((p) => mergeOnePick(p, quotes)),
    crypto: (picks.crypto ?? []).map((p) => mergeOnePick(p, quotes)),
  };
}

export function collectPickSymbols(picks: PicksResponse | null): string[] {
  if (!picks) return [];
  const kr = Array.isArray(picks.kr) ? picks.kr : [];
  const us = Array.isArray(picks.us) ? picks.us : [];
  const crypto = Array.isArray(picks.crypto) ? picks.crypto : [];
  return [...kr, ...us, ...crypto]
    .map((p) => p.symbol.trim().toUpperCase())
    .filter(Boolean);
}
