/**
 * 종목보관 — 주봉 MA20·60·120 대비 현재가 근접 표기
 */
import { buildDailyClosesIndex } from "./daily-bar-index.js";
import { sma } from "./golden-cross-detect.js";
import { loadStock } from "./stock-data.js";

export const WEEKLY_MA_PROXIMITY_PERIODS = [20, 60, 120];

const CACHE_MS = 30 * 60_000;
const CONCURRENCY = (() => {
  const n = Number(process.env.STOCK_VAULT_WK_MA_CONCURRENCY ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 4;
})();

const PROXIMITY_PCT = (() => {
  const n = Number(process.env.STOCK_VAULT_WK_MA_PROXIMITY_PCT ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 2;
})();

/** @type {Map<string, { at: number; candles: Array<{ close?: number }> }>} */
const weeklyChartCache = new Map();

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number | null | undefined} currentPrice
 * @param {{ proximityPct?: number }} [opts]
 */
export function detectWeeklyMaProximity(candles, currentPrice, opts = {}) {
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
  /** @type {Array<{ period: number; ma: number; diffPct: number; side: "above"|"below" }>} */
  const near = [];

  for (const period of WEEKLY_MA_PROXIMITY_PERIODS) {
    const series = sma(closes, period);
    const ma = series[last];
    if (ma == null || !Number.isFinite(ma) || ma <= 0) continue;
    const diffPct = (Math.abs(price - ma) / ma) * 100;
    if (diffPct <= proximityPct) {
      near.push({
        period,
        ma,
        diffPct,
        side: price >= ma ? "above" : "below",
      });
    }
  }

  near.sort((a, b) => a.diffPct - b.diffPct);
  return { near, updatedAtMs: Date.now() };
}

/**
 * @param {string} symbol
 * @param {number | null | undefined} currentPrice
 */
async function proximityForSymbol(symbol, currentPrice) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return { near: [], updatedAtMs: Date.now() };

  const price = Number(currentPrice);
  let candles = [];
  const chartHit = weeklyChartCache.get(sym);
  if (chartHit && Date.now() - chartHit.at < CACHE_MS) {
    candles = chartHit.candles;
  } else {
    try {
      const data = await loadStock(sym, "1wk");
      candles = Array.isArray(data?.candles) ? data.candles : [];
      weeklyChartCache.set(sym, { at: Date.now(), candles });
      if (weeklyChartCache.size > 1200) {
        const oldest = [...weeklyChartCache.entries()].sort(
          (a, b) => a[1].at - b[1].at,
        );
        for (let i = 0; i < 250 && i < oldest.length; i++) {
          weeklyChartCache.delete(oldest[i][0]);
        }
      }
    } catch {
      return { near: [], updatedAtMs: Date.now() };
    }
  }

  const livePrice =
    Number.isFinite(price) && price > 0 ? price : null;
  if (livePrice == null) {
    return { near: [], updatedAtMs: Date.now() };
  }
  return detectWeeklyMaProximity(candles, livePrice);
}

/**
 * @param {string[]} symbols
 * @param {Record<string, { price?: number }>} quotes
 */
export async function fetchWeeklyMaProximityMap(symbols, quotes = {}) {
  const uniq = [
    ...new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  /** @type {Record<string, { near: Array<{ period: number; ma: number; diffPct: number; side: "above"|"below" }>; updatedAtMs: number }>} */
  const out = {};

  let cursor = 0;
  async function worker() {
    while (cursor < uniq.length) {
      const idx = cursor++;
      const sym = uniq[idx];
      const q = quotes[sym];
      const price =
        q?.price != null && Number.isFinite(Number(q.price))
          ? Number(q.price)
          : null;
      out[sym] = await proximityForSymbol(sym, price);
    }
  }

  const workers = Math.min(CONCURRENCY, uniq.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
