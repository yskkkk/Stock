/** 박스권 실매매 — 단일 프로그램·1h/4h/1d·빗썸(앱) */

export const BOX_RANGE_MODEL_ID = "box-range";

/** @type {readonly ("1h"|"4h"|"1d")[]} */
export const BOX_RANGE_TIMEFRAMES = ["1h", "4h", "1d"];

/** TF별 최대 박스 폭(%) — Pine PRO 시드 끊김 (러프: 약간 넓게) */
export const BOX_RANGE_MAX_PCT = {
  "1h": 4,
  "4h": 6.5,
  "1d": 18,
};

export const BOX_RANGE_MIN_BARS = 10;
export const BOX_RANGE_LOOKBACK = 100;
/** 박스 높이 대비 상·하단 터치·거절 판정 폭 */
export const BOX_RANGE_TOUCH_THRESHOLD = 0.16;
export const BOX_RANGE_MAX_EXPAND_BARS = 120;
export const BOX_RANGE_EXPAND_EDGE_PCT = 16;
export const BOX_RANGE_EXPAND_GAP_BARS = 3;
/** S&P500 카탈로그 전체 스캔 주기 */
export const BOX_RANGE_SP500_SCAN_MS = 30 * 60 * 1000;
/** 국내(KOSPI/KOSDAQ) 카탈로그 전체 스캔 주기 */
export const BOX_RANGE_KR_SCAN_MS = 30 * 60 * 1000;
/** BTC(빗썸 KRW 봉) 카탈로그 스캔 주기 */
export const BOX_RANGE_CRYPTO_SCAN_MS = 30 * 60 * 1000;
/** 코인 1h·4h·1d(HTF) 박스권 — 비트·이더만 */
export const BOX_RANGE_CRYPTO_HTF_SYMBOLS = ["BTC-USDT", "ETH-USDT"];
/** @deprecated — BOX_RANGE_CRYPTO_HTF_SYMBOLS[0] */
export const BOX_RANGE_CRYPTO_CATALOG_SYMBOL = BOX_RANGE_CRYPTO_HTF_SYMBOLS[0];
/** 코인 HTF 제한 적용 봉 */
export const BOX_RANGE_CRYPTO_HTF_TIMEFRAMES = ["1h", "4h", "1d"];

const CRYPTO_HTF_SYMBOL_SET = new Set(BOX_RANGE_CRYPTO_HTF_SYMBOLS);

/** @param {string} [symbol] */
export function isBoxRangeCryptoHtfSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  return CRYPTO_HTF_SYMBOL_SET.has(s);
}

/** @param {string} [symbol] @param {"1h"|"4h"|"1d"} [timeframe] */
export function isBoxRangeCryptoHtfManaged(symbol, timeframe) {
  if (!BOX_RANGE_CRYPTO_HTF_TIMEFRAMES.includes(timeframe)) return true;
  return isBoxRangeCryptoHtfSymbol(symbol);
}
/** 차트 라이브 탐지·반환 상한 — 0이면 제한 없음 */
export const BOX_RANGE_MAX_DETECTED = 0;
/** Pine maxStoreZones — 카탈로그 스캔·엔진 저장, 0이면 제한 없음 */
export const BOX_RANGE_PINE_MAX_STORE = 0;

/** 기존 카탈로그(legacy detect-pro·overlap merge) */
export const BOX_RANGE_CATALOG_DIR_LEGACY = "box-range-catalog";
/** Pine f_zoneEngine 전체 차트 탐지 전용 저장 */
export const BOX_RANGE_CATALOG_DIR_PINE = "box-range-catalog-pine";

/** @deprecated legacy overlap merge — PRO는 BOX_RANGE_PRO_MERGE_MID_PCT */
export const BOX_RANGE_MIN_TOUCHES = 2;
export const BOX_RANGE_MERGE_PCT = 35;
export const BOX_RANGE_MERGE_BARS_GAP = 5;
export const BOX_RANGE_SIMILAR_RANGE_PCT = 8;

/** PRO v2 — box-range-pro-core.js · pine-box-range-pro.pine SSOT (러프 프리셋) */
export const BOX_RANGE_PRO_BAND_HIGH_PCT = 88;
export const BOX_RANGE_PRO_BAND_LOW_PCT = 12;
export const BOX_RANGE_PRO_MIN_REJECTIONS = 1;
/** 상·하단 터치 후 종가가 밴드 안쪽으로 밀린 비율(터치폭 × 이 값) */
export const BOX_RANGE_PRO_REJECT_CLOSE_FRAC = 0.4;
/** 병합: 중심가 차이(중간가 대비 %) 상한 */
export const BOX_RANGE_PRO_MERGE_MID_PCT = 2.5;
/** 병합: 박스 높이(%) 차이 상한 */
export const BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT = 35;
/** 가로 확장 중단 — 종가가 중심에서 벗어난 반높이 비율(%) */
export const BOX_RANGE_PRO_SPLIT_MID_PCT = {
  "1h": 38,
  "4h": 48,
  "1d": 58,
};

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
