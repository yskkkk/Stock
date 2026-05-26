/** 박스권 실매매 — 단일 프로그램·1h/4h/1d·빗썸(앱) */

export const BOX_RANGE_MODEL_ID = "box-range";

/** @type {readonly ("1h"|"4h"|"1d")[]} */
export const BOX_RANGE_TIMEFRAMES = ["1h", "4h", "1d"];

/** TF별 최대 박스 폭(%) — Pine PRO 시드 끊김 */
export const BOX_RANGE_MAX_PCT = {
  "1h": 3,
  "4h": 5,
  "1d": 15,
};

export const BOX_RANGE_MIN_BARS = 14;
export const BOX_RANGE_LOOKBACK = 100;
/** 박스 높이 대비 상·하단 터치 허용 (Pine 12%) */
export const BOX_RANGE_TOUCH_THRESHOLD = 0.12;
export const BOX_RANGE_MAX_EXPAND_BARS = 120;
export const BOX_RANGE_EXPAND_EDGE_PCT = 12;
export const BOX_RANGE_EXPAND_GAP_BARS = 2;
/** S&P500 카탈로그 전체 스캔 주기 */
export const BOX_RANGE_SP500_SCAN_MS = 30 * 60 * 1000;
/** 국내(KOSPI/KOSDAQ) 카탈로그 전체 스캔 주기 */
export const BOX_RANGE_KR_SCAN_MS = 30 * 60 * 1000;
/** Pine zonesPerTf(표시·API 반환 상한) */
export const BOX_RANGE_MAX_DETECTED = 35;
/** Pine maxStoreZones(엔진 내부 저장 상한) — 카탈로그 전체 스캔과 동일 */
export const BOX_RANGE_PINE_MAX_STORE = 40;

/** 기존 카탈로그(legacy detect-pro·overlap merge) */
export const BOX_RANGE_CATALOG_DIR_LEGACY = "box-range-catalog";
/** Pine f_zoneEngine 전체 차트 탐지 전용 저장 */
export const BOX_RANGE_CATALOG_DIR_PINE = "box-range-catalog-pine";

/** @deprecated detect-pro 전용 — Pine 탐지에는 미사용 */
export const BOX_RANGE_MIN_TOUCHES = 2;
export const BOX_RANGE_MERGE_PCT = 35;
export const BOX_RANGE_MERGE_BARS_GAP = 5;
export const BOX_RANGE_SIMILAR_RANGE_PCT = 8;

export function getBoxRangeTechModelStub() {
  const now = Date.now();
  return {
    id: BOX_RANGE_MODEL_ID,
    name: "박스권 (1h·4h·일)",
    weights: {},
    createdAtMs: now,
    updatedAtMs: now,
  };
}

export function isBoxRangeProgram(program) {
  return String(program?.modelId ?? "").trim() === BOX_RANGE_MODEL_ID;
}

/** 시세: STOCK_BOX_RANGE_QUOTE_* · WS: STOCK_BOX_RANGE_WS(0=off), STOCK_BITHUMB_WS_TICKER, STOCK_BOX_RANGE_WS_MAX_STALE_MS, BITHUMB_WS_* */
