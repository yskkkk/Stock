/** 일봉 MA5·20·60·120 골든크로스(5가 slow를 상향 돌파) */

export const GOLDEN_CROSS_MA_FAST = 5;
export const GOLDEN_CROSS_MA_SLOW_PERIODS = [20, 60, 120];

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
 * @param {Array<{ close?: number; time?: unknown }>} candles
 * @param {number} [barIndex]
 * @returns {{ crosses: ("5>20"|"5>60"|"5>120")[]; crossDate: string | null }}
 */
export function detectDailyGoldenCrossDetail(candles, barIndex) {
  const crosses = detectDailyGoldenCrosses(candles, barIndex);
  if (!crosses.length) return { crosses: [], crossDate: null };
  const i =
    barIndex == null
      ? candles.length - 1
      : Math.min(Math.max(0, barIndex), candles.length - 1);
  return {
    crosses,
    crossDate: candleTimeToDateKey(candles[i]?.time),
  };
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number} [barIndex] — 기본: 마지막 봉
 * @returns {("5>20"|"5>60"|"5>120")[]}
 */
export function detectDailyGoldenCrosses(candles, barIndex) {
  if (!Array.isArray(candles) || candles.length < 121) return [];
  const closes = candles.map((c) => Number(c?.close)).filter((v) => Number.isFinite(v));
  if (closes.length < 121) return [];

  const i =
    barIndex == null
      ? closes.length - 1
      : Math.min(Math.max(0, barIndex), closes.length - 1);
  if (i < 1) return [];

  const ma5 = sma(closes, GOLDEN_CROSS_MA_FAST);
  /** @type {("5>20"|"5>60"|"5>120")[]} */
  const crosses = [];

  for (const slow of GOLDEN_CROSS_MA_SLOW_PERIODS) {
    const maSlow = sma(closes, slow);
    if (
      isGoldenCrossBar(ma5[i - 1], ma5[i], maSlow[i - 1], maSlow[i])
    ) {
      crosses.push(`5>${slow}`);
    }
  }
  return crosses;
}
