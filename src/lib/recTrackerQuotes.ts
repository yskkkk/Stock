import type { PicksDailyHistoryQuotesMap } from "../api";
import {
  netReturnPctFromPrices,
  outcomeFromPricesWithFees,
} from "./netReturn";
import type {
  RecommendationOutcome,
  RecommendationTrackerItem,
  RecommendationTrackerRollup,
  RecommendationsTrackerResponse,
} from "../types";

function rollupCounts(
  items: Array<{ outcome: RecommendationOutcome }>,
): RecommendationTrackerRollup {
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let unknown = 0;
  for (const it of items) {
    if (it.outcome === "win") wins++;
    else if (it.outcome === "loss") losses++;
    else if (it.outcome === "flat") flats++;
    else unknown++;
  }
  const decided = wins + losses;
  const winRatePct = decided > 0 ? (wins / decided) * 100 : null;
  return { total: items.length, wins, losses, flats, unknown, winRatePct };
}

/** 최근 추천일 기준 심볼 우선(시세 배치 상한용) */
export function prioritizeTrackerSymbols(
  items: RecommendationTrackerItem[],
  max: number,
): string[] {
  const latest = new Map<string, string>();
  for (const it of items) {
    const sym = it.symbol.trim().toUpperCase();
    const prev = latest.get(sym);
    if (!prev || it.date > prev) latest.set(sym, it.date);
  }
  return [...latest.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, Math.max(0, max))
    .map(([sym]) => sym);
}

/** 이전 화면 시세를 유지한 채 새 시세를 덮어씀(새로고침 중 깜빡임 방지) */
export function applyTrackerQuotes(
  base: RecommendationsTrackerResponse,
  freshQuotes: PicksDailyHistoryQuotesMap,
  prev?: RecommendationsTrackerResponse | null,
): RecommendationsTrackerResponse {
  const combined: PicksDailyHistoryQuotesMap = {};
  if (prev) {
    for (const it of prev.items) {
      const sym = it.symbol.trim().toUpperCase();
      if (
        it.currentPrice != null &&
        Number.isFinite(it.currentPrice) &&
        it.currentPrice > 0
      ) {
        combined[sym] = { price: it.currentPrice };
      }
    }
  }
  for (const [sym, q] of Object.entries(freshQuotes)) {
    if (q?.price != null && Number.isFinite(q.price) && q.price > 0) {
      combined[sym] = q;
    }
  }
  return mergeQuotesIntoTrackerPayload(base, combined);
}

export function mergeQuotesIntoTrackerPayload(
  base: RecommendationsTrackerResponse,
  quotes: PicksDailyHistoryQuotesMap,
): RecommendationsTrackerResponse {
  const items = base.items.map((ev) => {
    const sym = ev.symbol.trim().toUpperCase();
    const q = quotes[sym];
    const currentPrice =
      q?.price != null && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    const changePct = netReturnPctFromPrices(ev.entryPrice, currentPrice);
    const outcome = outcomeFromPricesWithFees(ev.entryPrice, currentPrice);
    return { ...ev, currentPrice, changePct, outcome };
  });

  const summary = rollupCounts(items);

  const bySignal = new Map<string, typeof items>();
  for (const it of items) {
    const ids = it.signalIds.length ? it.signalIds : ["__none__"];
    for (const signalId of ids) {
      if (!bySignal.has(signalId)) bySignal.set(signalId, []);
      bySignal.get(signalId)!.push(it);
    }
  }

  const signalStats = [...bySignal.entries()]
    .map(([signalId, group]) => ({ signalId, ...rollupCounts(group) }))
    .filter((s) => s.signalId !== "__none__" || s.total > 0)
    .sort((a, b) => {
      const ar = a.winRatePct;
      const br = b.winRatePct;
      if (ar == null && br == null) return b.total - a.total;
      if (ar == null) return 1;
      if (br == null) return -1;
      if (br !== ar) return br - ar;
      return b.total - a.total;
    });

  const bySymbol = new Map<
    string,
    { symbol: string; name: string; market: string; items: typeof items }
  >();
  for (const it of items) {
    const key = `${it.market}:${it.symbol}`;
    if (!bySymbol.has(key)) {
      bySymbol.set(key, {
        symbol: it.symbol,
        name: it.name,
        market: it.market,
        items: [],
      });
    }
    bySymbol.get(key)!.items.push(it);
  }

  const symbolStats = [...bySymbol.values()]
    .map(({ symbol, name, market, items: group }) => ({
      symbol,
      name,
      market: market as RecommendationTrackerItem["market"],
      ...rollupCounts(group),
    }))
    .sort((a, b) => b.total - a.total);

  const byScore = new Map<number, typeof items>();
  for (const it of items) {
    if (it.score == null || !Number.isFinite(it.score)) continue;
    if (!byScore.has(it.score)) byScore.set(it.score, []);
    byScore.get(it.score)!.push(it);
  }

  const scoreStats = [...byScore.entries()]
    .map(([score, group]) => ({ score, ...rollupCounts(group) }))
    .sort((a, b) => b.score - a.score);

  return {
    ...base,
    updatedAtMs: Date.now(),
    summary,
    signalStats,
    scoreStats,
    symbolStats,
    items,
  };
}
