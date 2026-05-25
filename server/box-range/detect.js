import {
  BOX_RANGE_LOOKBACK,
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_MIN_TOUCHES,
  BOX_RANGE_TOUCH_THRESHOLD,
} from "./constants.js";

/**
 * @typedef {{ time: number; open: number; high: number; low: number; close: number }} Bar
 * @typedef {{
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   validBars: number;
 * }} DetectedBox
 */

/**
 * 확정봉 기준 박스 1개 탐지 (Pine 로직 포팅)
 * @param {Bar[]} candles — 시간 오름차순, 마지막 봉은 아직 미확정일 수 있음 → 호출측에서 slice
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {DetectedBox | null}
 */
export function detectBoxRangeOnCandles(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < BOX_RANGE_MIN_BARS + 2) {
    return null;
  }
  const maxPct = BOX_RANGE_MAX_PCT[timeframe] ?? 15;
  const n = candles.length;
  const end = n - 2;
  if (end < 1) return null;

  let validCount = 0;
  let maxVal = candles[end].high;
  let minVal = candles[end].low;
  let startIdx = end;

  const lookback = Math.min(BOX_RANGE_LOOKBACK, end);

  for (let i = 1; i <= lookback; i++) {
    const idx = end - i;
    if (idx < 0) break;
    const c = candles[idx];
    maxVal = Math.max(maxVal, c.high);
    minVal = Math.min(minVal, c.low);
    const rangePct = minVal > 0 ? ((maxVal - minVal) / minVal) * 100 : 999;
    if (rangePct <= maxPct) {
      validCount += 1;
      startIdx = idx;
    } else {
      break;
    }
  }

  if (validCount < BOX_RANGE_MIN_BARS) return null;

  const mid = (maxVal + minVal) / 2;
  const threshold = (maxVal - minVal) * BOX_RANGE_TOUCH_THRESHOLD;
  let topTouch = 0;
  let bottomTouch = 0;

  for (let i = 0; i < validCount; i++) {
    const idx = end - i;
    const c = candles[idx];
    if (c.high >= maxVal - threshold) topTouch += 1;
    if (c.low <= minVal + threshold) bottomTouch += 1;
  }

  if (topTouch < BOX_RANGE_MIN_TOUCHES || bottomTouch < BOX_RANGE_MIN_TOUCHES) {
    return null;
  }

  return {
    top: maxVal,
    bottom: minVal,
    mid,
    leftTime: candles[startIdx].time,
    rightTime: candles[end].time,
    validBars: validCount,
  };
}
