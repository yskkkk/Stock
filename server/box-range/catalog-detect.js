/**
 * 카탈로그 스캔·차트 탐지 TF 라우팅 — PRO(4h·1d) vs Pine(1h 추후)
 */

import {
  BOX_RANGE_PINE_MAX_STORE,
  BOX_RANGE_PRO_TIMEFRAMES,
} from "./constants.js";
import { detectBoxRangesProOnCandles } from "./detect-pro.js";

/** @param {number | undefined} n */
function resolveMaxStore(n) {
  if (n === 0) return Number.MAX_SAFE_INTEGER;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  const env = Number(process.env.STOCK_BOX_RANGE_PRO_MAX_STORE ?? 0);
  if (env === 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(12, Math.floor(env));
}

/**
 * @param {import("./box-range-pro-core.js").Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxStore]
 */
export function detectCatalogBoxesForTimeframe(candles, timeframe, maxStore) {
  if (!BOX_RANGE_PRO_TIMEFRAMES.includes(timeframe)) {
    return [];
  }
  return detectBoxRangesProOnCandles(
    candles,
    timeframe,
    resolveMaxStore(maxStore ?? BOX_RANGE_PINE_MAX_STORE),
  );
}

/** @param {"1h"|"4h"|"1d"} timeframe */
export function isProCatalogTimeframe(timeframe) {
  return BOX_RANGE_PRO_TIMEFRAMES.includes(timeframe);
}
