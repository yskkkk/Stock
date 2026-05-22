/** 기본 기술 점수 가중치 — technical.js·store 공용 */
export const SIGNAL_SCORE_WEIGHT = {
  ma_align: 2,
  ma_golden: 2,
  ma20: 1,
  ma50: 1,
  ma5_align: 1,
  rsi: 2,
  volume: 1,
  volume_surge: 1,
  macd: 1,
  high_60: 1,
  vp_breakout: 2,
  bull_bar: 0,
};

export const DEFAULT_MAX_TECH_SCORE = Object.values(SIGNAL_SCORE_WEIGHT).reduce(
  (a, b) => a + b,
  0,
);
