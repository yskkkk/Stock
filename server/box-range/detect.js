import { BOX_RANGE_MAX_DETECTED } from "./constants.js";
import {
  detectBoxRangesPineOnCandles,
  resolvePineDetectOpts,
} from "./detect-pine.js";

export {
  detectBoxRangesPineOnCandles,
  resolvePineDetectOpts,
  getPinePreset,
  pineBoxesShouldMerge,
} from "./detect-pine.js";

/**
 * @typedef {import("./detect-pine.js").Bar} Bar
 * @typedef {import("./detect-pine.js").DetectedBox} DetectedBox
 */

/**
 * @param {Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {DetectedBox | null}
 */
export function detectBoxRangeOnCandles(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < 16) return null;
  const list = detectBoxRangesPineOnCandles(
    candles,
    timeframe,
    1,
    resolvePineDetectOpts(),
  );
  return list[0] ?? null;
}

/**
 * 전체 캔들에 Pine f_zoneEngine 1회 통과 — TradingView 저장 배열과 동일 방식
 * @param {Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxCount]
 * @returns {DetectedBox[]}
 */
export function detectBoxRangesOnCandles(
  candles,
  timeframe,
  maxCount = BOX_RANGE_MAX_DETECTED,
) {
  return detectBoxRangesPineOnCandles(
    candles,
    timeframe,
    maxCount,
    resolvePineDetectOpts(),
  );
}
