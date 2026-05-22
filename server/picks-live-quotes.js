/**
 * 스크리너 목록 시세 — Yahoo v8 경량 스냅샷을 주기적으로 병합.
 * 프로세스 단위 캐시로 동일 심볼·짧은 간격 중복 호출을 줄인다.
 */
import { loadChartQuoteSnapshot1m } from "./stock-data.js";
import {
  expandSymbolsForYahooQuotes,
  inferMarketFromSymbol,
  normalizeYahooQuoteSymbol,
} from "./quote-symbol-resolve.js";

/** 1분봉 시세 — 기본 60초(분봉 갱신 주기) */
const TTL_MS = (() => {
  const n = Number(process.env.PICKS_LIVE_QUOTE_TTL_MS ?? 60_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(120_000, Math.floor(n)) : 60_000;
})();
const QUOTE_FETCH_CONCURRENCY = (() => {
  const n = Number(process.env.PICKS_QUOTE_FETCH_CONCURRENCY ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.min(24, Math.floor(n)) : 8;
})();
const QUOTE_FETCH_MAX_SYMBOLS = (() => {
  const n = Number(process.env.PICKS_QUOTE_FETCH_MAX ?? 600);
  return Number.isFinite(n) && n >= 1 ? Math.min(2000, Math.floor(n)) : 600;
})();

/** @type {Map<string, { at: number, quote: object | null }>} */
const cache = new Map();

/**
 * @param {string} symbol
 * @returns {Promise<object | null>}
 */
/**
 * @param {string} symbol
 * @param {{ maxAgeMs?: number }} [opts]
 */
async function quoteSnapshotCached(symbol, opts = {}) {
  const u = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!u) return null;

  const maxAge =
    typeof opts.maxAgeMs === "number" && Number.isFinite(opts.maxAgeMs)
      ? Math.max(0, opts.maxAgeMs)
      : TTL_MS;

  const now = Date.now();
  const hit = cache.get(u);
  if (maxAge > 0 && hit && now - hit.at < maxAge) return hit.quote;

  let quote = null;
  try {
    quote = await loadChartQuoteSnapshot1m(u);
  } catch {
    quote = null;
  }
  cache.set(u, { at: Date.now(), quote });
  return quote;
}

/**
 * @param {unknown} pick
 * @param {object | null} q
 */
function mergeQuoteIntoPick(pick, q) {
  if (!pick || typeof pick !== "object") return pick;
  if (!q || q.price == null || !Number.isFinite(q.price)) return pick;
  return {
    ...pick,
    price: q.price,
    change: q.change ?? pick.change,
    changePercent: q.changePercent ?? pick.changePercent,
    currency: q.currency ?? pick.currency,
    dayHigh: q.dayHigh ?? pick.dayHigh,
    dayLow: q.dayLow ?? pick.dayLow,
    marketState: q.marketState ?? pick.marketState,
    turnover: q.turnover ?? pick.turnover,
  };
}

/**
 * @param {string[]} symbols
 * @param {(sym: string) => Promise<void>} worker
 */
async function mapPool(symbols, worker) {
  const list = [...symbols];
  let i = 0;
  const n = Math.min(QUOTE_FETCH_CONCURRENCY, list.length || 1);
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= list.length) break;
        await worker(list[idx]);
      }
    }),
  );
}

/**
 * @param {string[]} symbols
 * @param {{ maxAgeMs?: number; market?: "kr" | "us" }} [opts]
 * @returns {Promise<Record<string, { price: number; changePercent?: number; currency?: string; quotedAtMs?: number }>>}
 */
export async function fetchQuoteSnapshotsForSymbols(symbols, opts = {}) {
  const requested = (Array.isArray(symbols) ? symbols : [])
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter(Boolean);
  const uniq = expandSymbolsForYahooQuotes(
    requested,
    opts.market === "us" ? "us" : "kr",
  ).slice(0, QUOTE_FETCH_MAX_SYMBOLS);

  const cacheOpts = { maxAgeMs: opts.maxAgeMs };

  /** @type {Record<string, { price: number; changePercent?: number; currency?: string; quotedAtMs?: number }>} */
  const out = {};

  const storeQuote = (/** @type {string} */ key, /** @type {object} */ q) => {
    if (!key || q.price == null || !Number.isFinite(q.price)) return;
    const row = {
      price: q.price,
      changePercent:
        typeof q.changePercent === "number" && Number.isFinite(q.changePercent)
          ? q.changePercent
          : undefined,
      currency: typeof q.currency === "string" ? q.currency : undefined,
      quotedAtMs:
        typeof q.quotedAtMs === "number" && q.quotedAtMs > 0
          ? q.quotedAtMs
          : Date.now(),
    };
    out[key] = row;
  };

  await mapPool(uniq, async (sym) => {
    const q = await quoteSnapshotCached(sym, cacheOpts);
    if (!q || q.price == null || !Number.isFinite(q.price)) return;
    storeQuote(sym, q);
  });

  const missing = uniq.filter((sym) => !out[sym]);
  if (missing.length > 0) {
    await mapPool(missing, async (sym) => {
      cache.delete(sym);
      const q = await quoteSnapshotCached(sym, { maxAgeMs: 0 });
      if (!q || q.price == null || !Number.isFinite(q.price)) return;
      storeQuote(sym, q);
    });
  }

  for (const raw of requested) {
    if (out[raw]) continue;
    const norm = normalizeYahooQuoteSymbol(raw, inferMarketFromSymbol(raw));
    if (out[norm]) out[raw] = out[norm];
    const bare = raw.replace(/\.(KS|KQ)$/i, "");
    if (bare !== raw && out[bare]) out[raw] = out[bare];
  }

  return out;
}

/**
 * 스크리너 전체 재스캔 중에는 청크마다 이미 시세가 들어가므로 추가 Yahoo 호출을 생략한다.
 *
 * @param {{ running?: boolean; kr?: unknown[]; us?: unknown[] }} state
 */
export async function mergeLiveQuotesIntoPicksState(state) {
  if (!state || state.running) return state;

  const krIn = Array.isArray(state.kr) ? state.kr : [];
  const usIn = Array.isArray(state.us) ? state.us : [];

  const [kr, us] = await Promise.all([
    Promise.all(
      krIn.map(async (p) =>
        mergeQuoteIntoPick(p, await quoteSnapshotCached(p?.symbol)),
      ),
    ),
    Promise.all(
      usIn.map(async (p) =>
        mergeQuoteIntoPick(p, await quoteSnapshotCached(p?.symbol)),
      ),
    ),
  ]);

  return { ...state, kr, us };
}
