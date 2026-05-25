import { BOX_RANGE_MAX_DETECTED } from "./constants.js";
import {
  detectBoxRangeProAt,
  detectBoxRangesProOnCandles,
} from "./detect-pro.js";

export { detectBoxRangeProAt, detectBoxRangesProOnCandles } from "./detect-pro.js";

/**
 * @typedef {import("./detect-pro.js").Bar} Bar
 * @typedef {import("./detect-pro.js").DetectedBox} DetectedBox
 */

/**
 * @param {Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {DetectedBox | null}
 */
export function detectBoxRangeOnCandles(candles, timeframe) {
  if (!Array.isArray(candles) || candles.length < 16) return null;
  const result = detectBoxRangeProAt(candles, candles.length - 2, timeframe);
  return result?.box ?? null;
}

/**
 * @param {Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {DetectedBox[]}
 */
export function detectBoxRangesOnCandles(candles, timeframe) {
  return detectBoxRangesProOnCandles(
    candles,
    timeframe,
    BOX_RANGE_MAX_DETECTED,
  );
}
