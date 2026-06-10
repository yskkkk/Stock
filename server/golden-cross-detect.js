/** 일·주봉 MA 교차 — Pine(5↔20·20↔120 골든·데드) + 기존 5→60·120 골든 */

import {
  buildDailyClosesIndex,
  resolveCandleBarIndex,
  resolveCloseIndexAtCandle,
} from "./daily-bar-index.js";

/** @typedef {"5>20"|"5<20"|"5>60"|"5>120"|"20>120"|"20<120"} MaCrossKind */

export const MA_CROSS_KINDS = /** @type {const} */ ([
  "5>20",
  "5<20",
  "5>60",
  "5>120",
  "20>120",
  "20<120",
]);

/** @deprecated MA_CROSS_PAIRS 사용 */
export const GOLDEN_CROSS_MA_FAST = 5;
/** @deprecated */
export const GOLDEN_CROSS_MA_SLOW_PERIODS = [20, 60, 120];

/** @type {Array<{ fast: number; slow: number; golden: MaCrossKind; dead: MaCrossKind | null }>} */
export const MA_CROSS_PAIRS = [
  { fast: 5, slow: 20, golden: "5>20", dead: "5<20" },
  { fast: 5, slow: 60, golden: "5>60", dead: null },
  { fast: 5, slow: 120, golden: "5>120", dead: null },
  { fast: 20, slow: 120, golden: "20>120", dead: "20<120" },
];

export const MA_CROSS_MIN_CANDLES = 121;

/**
 * @param {number[]} values
 * @param {number} period
 */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    out[i] = sum / period;
  }
  return out;
}

/**
 * Pine `ta.crossover(fast, slow)`
 * @param {number} fastPrev
 * @param {number} fastNow
 * @param {number} slowPrev
 * @param {number} slowNow
 */
export function isGoldenCrossBar(fastPrev, fastNow, slowPrev, slowNow) {
  if (
    !Number.isFinite(fastPrev) ||
    !Number.isFinite(fastNow) ||
    !Number.isFinite(slowPrev) ||
    !Number.isFinite(slowNow)
  ) {
    return false;
  }
  return fastPrev <= slowPrev && fastNow > slowNow;
}

/**
 * Pine `ta.crossunder(fast, slow)`
 * @param {number} fastPrev
 * @param {number} fastNow
 * @param {number} slowPrev
 * @param {number} slowNow
 */
export function isDeadCrossBar(fastPrev, fastNow, slowPrev, slowNow) {
  if (
    !Number.isFinite(fastPrev) ||
    !Number.isFinite(fastNow) ||
    !Number.isFinite(slowPrev) ||
    !Number.isFinite(slowNow)
  ) {
    return false;
  }
  return fastPrev >= slowPrev && fastNow < slowNow;
}

/** @param {unknown} kind */
export function isMaCrossKind(kind) {
  return MA_CROSS_KINDS.includes(kind);
}

/** @param {unknown} crosses */
export function normalizeMaCrossKinds(crosses) {
  if (!Array.isArray(crosses)) return [];
  return crosses.filter((c) => isMaCrossKind(c));
}

/**
 * @param {unknown} time
 * @returns {string | null} YYYY-MM-DD (KST 일봉 time 객체·unix ms/sec)
 */
export function candleTimeToDateKey(time) {
  if (time == null) return null;
  if (typeof time === "object") {
    const y = Number(time.year);
    const m = Number(time.month);
    const d = Number(time.day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return null;
    }
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (typeof time === "number" && Number.isFinite(time)) {
    const ms = time > 1e12 ? time : time * 1000;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
      new Date(ms),
    );
  }
  return null;
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number} [barIndex] — candles 기준; 기본: 마지막 봉
 * @returns {MaCrossKind[]}
 */
export function detectMaCrosses(candles, barIndex) {
  if (!Array.isArray(candles) || candles.length < MA_CROSS_MIN_CANDLES) {
    return [];
  }
  const { closes, candleToCloseIndex } = buildDailyClosesIndex(candles);
  if (closes.length < MA_CROSS_MIN_CANDLES) return [];

  const { candleIndex: ci } = resolveCandleBarIndex(
    candleToCloseIndex,
    barIndex,
    candles.length,
  );
  if (ci < 1) return [];

  const idxNow = resolveCloseIndexAtCandle(candleToCloseIndex, ci);
  const idxPrev = resolveCloseIndexAtCandle(candleToCloseIndex, ci - 1);
  if (idxNow < 0 || idxPrev < 0) return [];

  /** @type {MaCrossKind[]} */
  const crosses = [];

  for (const pair of MA_CROSS_PAIRS) {
    const maFast = sma(closes, pair.fast);
    const maSlow = sma(closes, pair.slow);
    const fastPrev = maFast[idxPrev];
    const fastNow = maFast[idxNow];
    const slowPrev = maSlow[idxPrev];
    const slowNow = maSlow[idxNow];
    if (isGoldenCrossBar(fastPrev, fastNow, slowPrev, slowNow)) {
      crosses.push(pair.golden);
    }
    if (
      pair.dead &&
      isDeadCrossBar(fastPrev, fastNow, slowPrev, slowNow)
    ) {
      crosses.push(pair.dead);
    }
  }
  return crosses;
}

/**
 * @param {Array<{ close?: number; time?: unknown }>} candles
 * @param {number} [barIndex] — candles 기준
 * @returns {{ crosses: MaCrossKind[]; crossDate: string | null }}
 */
export function detectDailyGoldenCrossDetail(candles, barIndex) {
  const { candleToCloseIndex } = buildDailyClosesIndex(candles);
  const { candleIndex } = resolveCandleBarIndex(
    candleToCloseIndex,
    barIndex,
    candles.length,
  );
  const crosses = detectMaCrosses(candles, candleIndex);
  if (!crosses.length) return { crosses: [], crossDate: null };
  const i = Math.min(Math.max(0, candleIndex), candles.length - 1);
  return {
    crosses,
    crossDate: candleTimeToDateKey(candles[i]?.time),
  };
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number} [barIndex]
 * @returns {MaCrossKind[]}
 */
export function detectDailyGoldenCrosses(candles, barIndex) {
  return detectMaCrosses(candles, barIndex);
}
