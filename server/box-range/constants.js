/** 박스권 실매매 — 단일 프로그램·1h/4h/1d·빗썸(앱) */

export const BOX_RANGE_MODEL_ID = "box-range";

/** @type {readonly ("1h"|"4h"|"1d")[]} */
export const BOX_RANGE_TIMEFRAMES = ["1h", "4h", "1d"];

/** TF별 최대 박스 폭(%) — chart-overlay 참고용으로만 유지, 탐지 로직에서는 미사용 */
export const BOX_RANGE_MAX_PCT = {
  "1h": 3,
  "4h": 5,
  "1d": 15,
};

export const BOX_RANGE_MIN_BARS = 14;
export const BOX_RANGE_LOOKBACK = 100;
export const BOX_RANGE_TOUCH_THRESHOLD = 0.20;
/** 탐지 창 1개당 최대 봉 수 — lookback과 별개로 다중 창 스캔 간격에 사용 */
export const BOX_RANGE_MAX_DETECTED = 5;
export const BOX_RANGE_MIN_TOUCHES = 2;

/** 동일 TF·동일 종목 내 겹침만 병합 — 1h/4h/1d 간 겹침은 병합하지 않음(각각 매매). */
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
