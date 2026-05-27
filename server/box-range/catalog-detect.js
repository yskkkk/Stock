/**
 * 카탈로그 스캔·차트 탐지 TF 라우팅 — PRO(4h·1d) vs V2 vs Pine(1h 추후)
 */

import {
  BOX_RANGE_PINE_MAX_STORE,
  BOX_RANGE_PRO_TIMEFRAMES,
} from "./constants.js";
import { detectBoxRangesProOnCandles } from "./detect-pro.js";
import { detectBoxRangesV2OnCandles } from "./box-range-v2-core.js";

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

/**
 * V2 탐지(ER필터+고저퍼센타일+POC) — 모델 ⑩ 확인캔들 FSM과 연동
 * @param {import("./box-range-pro-core.js").Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxStore]
 */
export function detectCatalogBoxesV2ForTimeframe(candles, timeframe, maxStore) {
  if (!BOX_RANGE_PRO_TIMEFRAMES.includes(timeframe)) {
    return [];
  }
  return detectBoxRangesV2OnCandles(
    candles,
    timeframe,
    resolveMaxStore(maxStore ?? BOX_RANGE_PINE_MAX_STORE),
  );
}

/** @param {"1h"|"4h"|"1d"} timeframe */
export function isProCatalogTimeframe(timeframe) {
  return BOX_RANGE_PRO_TIMEFRAMES.includes(timeframe);
}
