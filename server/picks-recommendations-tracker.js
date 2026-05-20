/**
 * 일자별 추천 이력 → 추천가·현재가·승패·근거별 승률 집계
 */
import {
  backfillMissingSignalIdsFromTechnical,
  enrichSlimPickFromBackfill,
  lookupTelegramNotifyForRecommendation,
  reconcileRecommendationHistoryEnrichmentSync,
} from "./picks-recommendation-enrich.js";
import { getPicksDailyHistoryForApi } from "./picks-history-store.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";

let reconcileOnce = false;
let backfillScheduled = false;

const TRACKER_CACHE_MS = (() => {
  const n = Number(process.env.STOCK_REC_TRACKER_CACHE_MS ?? 20_000);
  return Number.isFinite(n) && n >= 0 ? Math.min(120_000, Math.floor(n)) : 20_000;
})();
const TRACKER_QUOTE_MAX = (() => {
  const n = Number(process.env.STOCK_REC_TRACKER_QUOTE_MAX ?? 96);
  return Number.isFinite(n) && n >= 0 ? Math.min(600, Math.floor(n)) : 96;
})();

/** @type {{ at: number, payload: object } | null} */
let trackerCache = null;
/** @type {Promise<object> | null} */
let trackerInflight = null;

/**
 * @param {ReturnType<typeof slimToEvent>[]} events
 * @returns {string[]}
 */
function symbolsByRecency(events) {
  /** @type {Map<string, string>} */
  const latest = new Map();
  for (const e of events) {
    const sym = String(e.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    const prev = latest.get(sym);
    if (!prev || e.date > prev) latest.set(sym, e.date);
  }
  return [...latest.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([sym]) => sym);
}

/** 요청을 막지 않고 백그라운드에서 근거·점수 보강 */
export function scheduleRecommendationSignalBackfill() {
  if (backfillScheduled) return;
  if (process.env.STOCK_REC_SIGNAL_BACKFILL === "0") return;
  backfillScheduled = true;
  const max = Number(process.env.STOCK_REC_SIGNAL_BACKFILL_MAX ?? 40);
  void backfillMissingSignalIdsFromTechnical(max)
    .catch((e) => {
      backfillScheduled = false;
      console.warn(
        "[recommendations-tracker] signal backfill:",
        e instanceof Error ? e.message : e,
      );
    });
}

const VALID_SIGNAL = new Set([
  "ma_align",
  "ma_golden",
  "ma20",
  "ma50",
  "ma5_align",
  "rsi",
  "volume",
  "volume_surge",
  "macd",
  "high_60",
  "bull_bar",
]);

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeSignalIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? "").trim())
    .filter((id) => VALID_SIGNAL.has(id));
}

/**
 * @param {import("./picks-history-store.js").SlimPick | Record<string, unknown>} p
 * @param {"kr"|"us"} market
 * @param {string} date
 */
function slimToEvent(p, market, date) {
  const symbol = String(p.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const price = p.price;
  const entryPrice =
    typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  const currency =
    typeof p.currency === "string" && p.currency.trim()
      ? p.currency.trim()
      : market === "kr"
        ? "KRW"
        : "USD";
  const recordedAtMs =
    typeof p.recordedAtMs === "number" && Number.isFinite(p.recordedAtMs) && p.recordedAtMs > 0
      ? p.recordedAtMs
      : null;

  const sc = p.score;
  const score =
    typeof sc === "number" && Number.isFinite(sc) && sc >= 0 ? Math.round(sc) : null;

  return {
    id: `${date}:${market}:${symbol}`,
    date,
    market,
    symbol,
    name: String(p.name ?? "").trim() || symbol,
    currency,
    entryPrice,
    recordedAtMs,
    signalIds: normalizeSignalIds(p.signalIds),
    score,
  };
}

/**
 * @param {number | null} entry
 * @param {number | null} current
 * @returns {"win"|"loss"|"flat"|"unknown"}
 */
function outcomeFromPrices(entry, current) {
  if (
    entry == null ||
    current == null ||
    !Number.isFinite(entry) ||
    !Number.isFinite(current) ||
    entry <= 0
  ) {
    return "unknown";
  }
  const pct = ((current - entry) / entry) * 100;
  if (Math.abs(pct) < 0.005) return "flat";
  return pct > 0 ? "win" : "loss";
}

/**
 * @param {number | null} entry
 * @param {number | null} current
 * @returns {number | null}
 */
function pctFromPrices(entry, current) {
  if (
    entry == null ||
    current == null ||
    !Number.isFinite(entry) ||
    !Number.isFinite(current) ||
    entry <= 0
  ) {
    return null;
  }
  return ((current - entry) / entry) * 100;
}

/**
 * @param {Array<{ outcome: string }>} items
 */
function rollupCounts(items) {
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
  return {
    total: items.length,
    wins,
    losses,
    flats,
    unknown,
    winRatePct,
  };
}

/**
 * @param {{ includeQuotes?: boolean }} [opts]
 */
async function buildRecommendationsTrackerPayloadInner(opts = {}) {
  const includeQuotes = opts.includeQuotes !== false;

  if (!reconcileOnce) {
    reconcileOnce = true;
    reconcileRecommendationHistoryEnrichmentSync();
  }
  scheduleRecommendationSignalBackfill();

  const { days } = getPicksDailyHistoryForApi();
  /** @type {ReturnType<typeof slimToEvent>[]} */
  const baseEvents = [];
  for (const day of days) {
    const date = String(day.date ?? "").trim();
    if (!date) continue;
    for (const p of day.kr ?? []) {
      enrichSlimPickFromBackfill(p, "kr", date);
      const ev = slimToEvent(p, "kr", date);
      if (ev) baseEvents.push(ev);
    }
    for (const p of day.us ?? []) {
      enrichSlimPickFromBackfill(p, "us", date);
      const ev = slimToEvent(p, "us", date);
      if (ev) baseEvents.push(ev);
    }
  }

  baseEvents.sort((a, b) => {
    const dc = b.date.localeCompare(a.date);
    if (dc !== 0) return dc;
    return a.symbol.localeCompare(b.symbol, "ko");
  });

  /** @type {Record<string, { price: number; changePercent?: number }>} */
  let quotes = {};
  if (includeQuotes && TRACKER_QUOTE_MAX > 0) {
    const ordered = symbolsByRecency(baseEvents).slice(0, TRACKER_QUOTE_MAX);
    quotes = await fetchQuoteSnapshotsForSymbols(ordered);
  }

  const items = baseEvents.map((ev) => {
    const q = quotes[ev.symbol];
    const currentPrice =
      q?.price != null && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
    const changePct = pctFromPrices(ev.entryPrice, currentPrice);
    const outcome = outcomeFromPrices(ev.entryPrice, currentPrice);
    const tg =
      ev.market === "kr" || ev.market === "us"
        ? lookupTelegramNotifyForRecommendation(ev.date, ev.market, ev.symbol)
        : null;
    return {
      ...ev,
      currentPrice,
      changePct,
      outcome,
      telegramNotified: Boolean(tg),
      telegramNotifiedAtMs: tg?.atMs ?? null,
    };
  });

  const summary = rollupCounts(items);

  /** @type {Map<string, { signalId: string; items: typeof items }>} */
  const bySignal = new Map();
  for (const it of items) {
    const ids = it.signalIds.length ? it.signalIds : ["__none__"];
    for (const signalId of ids) {
      if (!bySignal.has(signalId)) bySignal.set(signalId, { signalId, items: [] });
      bySignal.get(signalId).items.push(it);
    }
  }

  const signalStats = [...bySignal.values()]
    .map(({ signalId, items: group }) => ({
      signalId,
      ...rollupCounts(group),
    }))
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

  /** @type {Map<string, { symbol: string; name: string; market: string; items: typeof items }>} */
  const bySymbol = new Map();
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
    bySymbol.get(key).items.push(it);
  }

  const symbolStats = [...bySymbol.values()]
    .map(({ symbol, name, market, items: group }) => ({
      symbol,
      name,
      market,
      ...rollupCounts(group),
    }))
    .sort((a, b) => b.total - a.total);

  /** @type {Map<number, typeof items>} */
  const byScore = new Map();
  for (const it of items) {
    if (it.score == null || !Number.isFinite(it.score)) continue;
    const key = it.score;
    if (!byScore.has(key)) byScore.set(key, []);
    byScore.get(key).push(it);
  }

  const scoreStats = [...byScore.entries()]
    .map(([score, group]) => ({
      score,
      ...rollupCounts(group),
    }))
    .sort((a, b) => b.score - a.score);

  const dates = [...new Set(items.map((it) => it.date))].sort((a, b) => b.localeCompare(a));

  return {
    updatedAtMs: Date.now(),
    dates,
    summary,
    signalStats,
    scoreStats,
    symbolStats,
    items,
  };
}

/**
 * @param {{ includeQuotes?: boolean }} [opts]
 */
export async function buildRecommendationsTrackerPayload(opts = {}) {
  const includeQuotes = opts.includeQuotes !== false;
  const cacheKey = includeQuotes ? "q" : "nq";
  const now = Date.now();

  if (TRACKER_CACHE_MS > 0 && trackerCache?.key === cacheKey && now - trackerCache.at < TRACKER_CACHE_MS) {
    return trackerCache.payload;
  }

  if (trackerInflight) return trackerInflight;

  trackerInflight = (async () => {
    try {
      const payload = await buildRecommendationsTrackerPayloadInner(opts);
      if (TRACKER_CACHE_MS > 0) {
        trackerCache = { key: cacheKey, at: Date.now(), payload };
      }
      return payload;
    } finally {
      trackerInflight = null;
    }
  })();

  return trackerInflight;
}
