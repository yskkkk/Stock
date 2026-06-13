/**
 * 종목보관 — 일봉·주봉 추세 + MA20·60·120 근접·접근 방향
 */
import { buildDailyClosesIndex } from "./daily-bar-index.js";
import { sma } from "./golden-cross-detect.js";
import { loadStock } from "./stock-data.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

export const MA_PROXIMITY_PERIODS = [20, 60, 120];

const STORE_FILE = "stock-vault-chart-insights.json";
const CHART_CACHE_MS = 30 * 60_000;
const STORE_TTL_MS = 30 * 60_000;
const REFRESH_DEBOUNCE_MS = 800;
const MAX_SYMBOLS_PER_REFRESH = 35;
const CONCURRENCY = (() => {
  const n = Number(process.env.STOCK_VAULT_CHART_INSIGHTS_CONCURRENCY ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 8;
})();

const PROXIMITY_PCT = (() => {
  const n = Number(process.env.STOCK_VAULT_WK_MA_PROXIMITY_PCT ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 2;
})();

/** @type {Map<string, { at: number; candles: Array<{ close?: number }> }>} */
const chartCache = new Map();
/** @type {Promise<void> | null} */
let refreshInFlight = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;

/**
 * @param {Array<{ close?: number }>} candles
 * @returns {"up"|"down"|"neutral"}
 */
export function detectMaTrend(candles) {
  const { closes } = buildDailyClosesIndex(candles);
  if (closes.length < 60) return "neutral";
  const last = closes.length - 1;
  const ma5 = sma(closes, 5)[last];
  const ma20 = sma(closes, 20)[last];
  const ma60 = sma(closes, 60)[last];
  if (
    ma5 == null ||
    ma20 == null ||
    ma60 == null ||
    !Number.isFinite(ma5) ||
    !Number.isFinite(ma20) ||
    !Number.isFinite(ma60)
  ) {
    return "neutral";
  }
  if (ma5 > ma20 && ma20 > ma60) return "up";
  if (ma5 < ma20 && ma20 < ma60) return "down";
  return "neutral";
}

/**
 * @param {number} price
 * @param {number} prevPrice
 * @param {number} ma
 * @param {number} distNow
 * @param {number} distPrev
 * @returns {"from_below"|"from_above"|"flat"}
 */
export function detectMaApproach(price, prevPrice, ma, distNow, distPrev) {
  const sideBelow = price < ma ? "from_below" : price > ma ? "from_above" : "flat";
  if (!Number.isFinite(distPrev) || distPrev <= 0) return sideBelow;
  const gettingCloser = distNow < distPrev * 0.985;
  if (gettingCloser) {
    if (price < ma && price >= prevPrice) return "from_below";
    if (price > ma && price <= prevPrice) return "from_above";
    if (price < ma) return "from_below";
    if (price > ma) return "from_above";
  }
  return sideBelow;
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number | null | undefined} currentPrice
 * @param {{ proximityPct?: number }} [opts]
 */
export function detectMaProximity(candles, currentPrice, opts = {}) {
  const proximityPct = opts.proximityPct ?? PROXIMITY_PCT;
  const price = Number(currentPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { near: [], updatedAtMs: Date.now() };
  }
  if (!Array.isArray(candles) || candles.length < 120) {
    return { near: [], updatedAtMs: Date.now() };
  }

  const { closes } = buildDailyClosesIndex(candles);
  if (closes.length < 120) {
    return { near: [], updatedAtMs: Date.now() };
  }

  const last = closes.length - 1;
  const lookback = Math.min(4, last);
  const prevPrice = closes[last - lookback];
  /** @type {Array<{ period: number; ma: number; diffPct: number; side: "above"|"below"; approach: "from_below"|"from_above"|"flat" }>} */
  const near = [];

  for (const period of MA_PROXIMITY_PERIODS) {
    const series = sma(closes, period);
    const ma = series[last];
    if (ma == null || !Number.isFinite(ma) || ma <= 0) continue;
    const diffPct = (Math.abs(price - ma) / ma) * 100;
    if (diffPct > proximityPct) continue;
    const distNow = Math.abs(price - ma);
    const distPrev = Math.abs(prevPrice - ma);
    near.push({
      period,
      ma,
      diffPct,
      side: price >= ma ? "above" : "below",
      approach: detectMaApproach(price, prevPrice, ma, distNow, distPrev),
    });
  }

  near.sort((a, b) => a.diffPct - b.diffPct);
  return { near, updatedAtMs: Date.now() };
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number | null | undefined} currentPrice
 */
export function buildTimeframeChartInsight(candles, currentPrice) {
  return {
    trend: detectMaTrend(candles),
    near: detectMaProximity(candles, currentPrice).near,
  };
}

/**
 * @param {"1d"|"1wk"} chartTf
 * @param {string} symbol
 */
async function loadChartCandles(chartTf, symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const cacheKey = `${sym}:${chartTf}`;
  const hit = chartCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CHART_CACHE_MS) {
    return hit.candles;
  }
  const data = await loadStock(sym, chartTf);
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  chartCache.set(cacheKey, { at: Date.now(), candles });
  if (chartCache.size > 800) {
    const oldest = [...chartCache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < 200 && i < oldest.length; i++) {
      chartCache.delete(oldest[i][0]);
    }
  }
  return candles;
}

/**
 * @param {string} symbol
 * @param {number | null | undefined} currentPrice
 */
export async function buildSymbolChartInsight(symbol, currentPrice) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const price = Number(currentPrice);
  if (!sym || !Number.isFinite(price) || price <= 0) {
    return {
      daily: { trend: "neutral", near: [] },
      weekly: { trend: "neutral", near: [] },
      updatedAtMs: Date.now(),
    };
  }
  try {
    const [dailyCandles, weeklyCandles] = await Promise.all([
      loadChartCandles("1d", sym),
      loadChartCandles("1wk", sym),
    ]);
    return {
      daily: buildTimeframeChartInsight(dailyCandles, price),
      weekly: buildTimeframeChartInsight(weeklyCandles, price),
      updatedAtMs: Date.now(),
    };
  } catch {
    return {
      daily: { trend: "neutral", near: [] },
      weekly: { trend: "neutral", near: [] },
      updatedAtMs: Date.now(),
    };
  }
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const root = /** @type {Record<string, unknown>} */ (raw ?? {});
  const bySymbol =
    root.bySymbol && typeof root.bySymbol === "object"
      ? /** @type {Record<string, object>} */ (root.bySymbol)
      : {};
  return {
    version: 1,
    updatedAtMs:
      typeof root.updatedAtMs === "number" && Number.isFinite(root.updatedAtMs)
        ? root.updatedAtMs
        : 0,
    bySymbol,
  };
}

export function readStockVaultChartInsightsSync() {
  const store = readJsonStoreSync(STORE_FILE, normalizeStore, () => ({
    version: 1,
    updatedAtMs: 0,
    bySymbol: {},
  }));
  return store.bySymbol ?? {};
}

/**
 * @param {Record<string, unknown>} record
 * @param {string[]} symbols
 */
export function pickVaultMapBySymbols(record, symbols) {
  /** @type {Record<string, object>} */
  const out = {};
  for (const raw of symbols) {
    const sym = String(raw ?? "").trim().toUpperCase();
    if (!sym) continue;
    const row = record?.[sym];
    if (row && typeof row === "object") out[sym] = /** @type {object} */ (row);
  }
  return out;
}

/** @param {unknown} row */
function symbolInsightStale(row) {
  if (!row || typeof row !== "object") return true;
  const ts = Number(/** @type {{ updatedAtMs?: unknown }} */ (row).updatedAtMs);
  return !Number.isFinite(ts) || Date.now() - ts > STORE_TTL_MS;
}

function writeInsightsStore(bySymbol) {
  writeJsonStoreSync(STORE_FILE, {
    version: 1,
    updatedAtMs: Date.now(),
    bySymbol,
  });
}

/**
 * @param {string[]} symbols
 * @param {Record<string, { price?: number }>} quotes
 */
export async function refreshStockVaultChartInsightsAsync(symbols, quotes = {}) {
  const uniq = [
    ...new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (!uniq.length) {
    writeInsightsStore({});
    return {};
  }

  const prev = readStockVaultChartInsightsSync();
  /** @type {Record<string, object>} */
  const out = pickVaultMapBySymbols(prev, uniq);
  const staleSyms = uniq.filter((sym) => symbolInsightStale(out[sym]));
  const batch = staleSyms.slice(0, MAX_SYMBOLS_PER_REFRESH);
  let cursor = 0;

  async function worker() {
    while (cursor < batch.length) {
      const idx = cursor++;
      const sym = batch[idx];
      const q = quotes[sym];
      const price =
        q?.price != null && Number.isFinite(Number(q.price))
          ? Number(q.price)
          : null;
      out[sym] = await buildSymbolChartInsight(sym, price);
    }
  }

  if (batch.length > 0) {
    const workers = Math.min(CONCURRENCY, batch.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
  writeInsightsStore(out);

  if (staleSyms.length > batch.length) {
    scheduleStockVaultChartInsightsRefresh(uniq, quotes);
  }
  return out;
}

/**
 * @param {string[]} symbols
 * @param {Record<string, { price?: number }>} quotes
 */
export function scheduleStockVaultChartInsightsRefresh(symbols, quotes = {}) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (refreshInFlight) return;
    refreshInFlight = refreshStockVaultChartInsightsAsync(symbols, quotes)
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * @param {string[]} symbols
 * @param {Record<string, { price?: number }>} quotes
 */
export async function fetchStockVaultChartInsightsMap(symbols, quotes = {}) {
  const cached = readStockVaultChartInsightsSync();
  const store = readJsonStoreSync(STORE_FILE, normalizeStore, () => ({
    version: 1,
    updatedAtMs: 0,
    bySymbol: {},
  }));
  const stale =
    !store.updatedAtMs || Date.now() - store.updatedAtMs > STORE_TTL_MS;
  if (!stale && Object.keys(cached).length > 0) {
    scheduleStockVaultChartInsightsRefresh(symbols, quotes);
    return cached;
  }
  if (refreshInFlight) {
    await refreshInFlight.catch(() => {});
    return readStockVaultChartInsightsSync();
  }
  return refreshStockVaultChartInsightsAsync(symbols, quotes);
}

/** @deprecated weeklyMaProximity 호환 */
export async function fetchWeeklyMaProximityMap(symbols, quotes = {}) {
  const map = await fetchStockVaultChartInsightsMap(symbols, quotes);
  /** @type {Record<string, { near: unknown[]; updatedAtMs: number }>} */
  const out = {};
  for (const [sym, row] of Object.entries(map)) {
    const weekly = /** @type {{ weekly?: { near?: unknown[] }; updatedAtMs?: number } }} */ (
      row
    );
    out[sym] = {
      near: weekly.weekly?.near ?? [],
      updatedAtMs: weekly.updatedAtMs ?? Date.now(),
    };
  }
  return out;
}

/** @deprecated */
export function detectWeeklyMaProximity(candles, currentPrice, opts = {}) {
  return detectMaProximity(candles, currentPrice, opts);
}
