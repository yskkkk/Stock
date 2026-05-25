import {
  BOX_RANGE_LOOKBACK,
  BOX_RANGE_MAX_DETECTED,
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
 * 단일 앵커 기준 박스 탐지 — maxPct 제한 없이 lookback 전체 활용
 * @param {Bar[]} candles
 * @param {number} endIdx — 앵커 봉 인덱스
 * @returns {{ box: DetectedBox; startIdx: number } | null}
 */
function detectBoxAt(candles, endIdx) {
  const end = endIdx;
  if (end < 1 || end >= candles.length) return null;

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
    validCount += 1;
    startIdx = idx;
  }

  if (validCount < BOX_RANGE_MIN_BARS) return null;

  const mid = (maxVal + minVal) / 2;
  const threshold = (maxVal - minVal) * BOX_RANGE_TOUCH_THRESHOLD;
  let topTouch = 0;
  let bottomTouch = 0;

  for (let i = 0; i <= validCount; i++) {
    const idx = end - i;
    if (idx < 0) break;
    const c = candles[idx];
    if (c.high >= maxVal - threshold) topTouch += 1;
    if (c.low <= minVal + threshold) bottomTouch += 1;
  }

  if (topTouch < BOX_RANGE_MIN_TOUCHES || bottomTouch < BOX_RANGE_MIN_TOUCHES) {
    return null;
  }

  return {
    box: {
      top: maxVal,
      bottom: minVal,
      mid,
      leftTime: candles[startIdx].time,
      rightTime: candles[end].time,
      validBars: validCount,
    },
    startIdx,
  };
}

/**
 * 확정봉 기준 박스 1개 탐지 (backward compat)
 * @param {Bar[]} candles — 시간 오름차순, 호출측에서 미확정 마지막 봉 제외
 * @param {"1h"|"4h"|"1d"} _timeframe
 * @returns {DetectedBox | null}
 */
export function detectBoxRangeOnCandles(candles, _timeframe) {
  if (!Array.isArray(candles) || candles.length < BOX_RANGE_MIN_BARS + 2) {
    return null;
  }
  const result = detectBoxAt(candles, candles.length - 2);
  return result?.box ?? null;
}

/**
 * 다중 창 스캔 — 비겹침 박스를 최대 BOX_RANGE_MAX_DETECTED 개 반환
 * @param {Bar[]} candles — 시간 오름차순, 호출측에서 미확정 마지막 봉 제외
 * @param {"1h"|"4h"|"1d"} _timeframe
 * @returns {DetectedBox[]}
 */
export function detectBoxRangesOnCandles(candles, _timeframe) {
  if (!Array.isArray(candles) || candles.length < BOX_RANGE_MIN_BARS + 2) {
    return [];
  }
  const results = [];
  let searchEnd = candles.length - 2;

  while (results.length < BOX_RANGE_MAX_DETECTED && searchEnd >= BOX_RANGE_MIN_BARS + 1) {
    const result = detectBoxAt(candles, searchEnd);
    if (result) {
      results.push(result.box);
      searchEnd = result.startIdx - 1;
    } else {
      searchEnd -= Math.ceil(BOX_RANGE_LOOKBACK / 2);
    }
  }

  return results;
}
