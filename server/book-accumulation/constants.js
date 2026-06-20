/** 서버 매집봉 스캔 기본값 — Pine 세력통합 사용자 프리셋(느슨·RVOL 1.5·하락선행 OFF·본전필수) */

export const BOOK_ACCUM_MIN_CANDLES = 80;

export const BOOK_ACCUM_SERVER_DEFAULTS = {
  preset: "느슨",
  volLen: 20,
  minRvol: 1.5,
  needDrop: false,
  dropLb: 40,
  minDropPct: 6,
  needVolMaUp: true,
  useCost: true,
  costTolPct: 5.0,
  pivotLen: 10,
  recoverDays: 5,
  consecWin: 3,
  minConsec: 2,
  minScore: 55,
  needCostCtx: true,
  riseLb: 20,
  minRisePct: 5.0,
  peakRvol: 2.5,
};
