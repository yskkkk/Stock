/**
 * Pine PRO 탐지 — 알고리즘 SSOT는 box-range-pro-core.js
 * @see scripts/pine-box-range-pro.pine
 */

import {
  barInBand,
  barNearMid,
  barCanExtend,
  typicalPrice,
  percentileLinear,
  computeBoxFromSlice,
  expandRangeIdxPro,
  countRejections,
  midDistancePct,
  boxHeightPct,
  shouldMergeProBoxes,
  splitMidPctForTimeframe,
  detectBoxRangeProAt,
  detectBoxRangesProOnCandles,
} from "./box-range-pro-core.js";

export {
  barInBand,
  barNearMid,
  barCanExtend,
  typicalPrice,
  percentileLinear,
  computeBoxFromSlice,
  expandRangeIdxPro,
  countRejections,
  midDistancePct,
  boxHeightPct,
  shouldMergeProBoxes,
  splitMidPctForTimeframe,
  detectBoxRangeProAt,
  detectBoxRangesProOnCandles,
};

/** @deprecated expandRangeIdxPro 사용 */
export { expandRangeIdxPro as expandRangeIdx } from "./box-range-pro-core.js";

/** @deprecated computeBoxFromSlice 사용 */
export function recalcBoxPrices(candles, leftIdx, rightIdx) {
  return computeBoxFromSlice(candles, rightIdx, leftIdx);
}
