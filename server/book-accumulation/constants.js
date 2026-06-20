/** 서버 매집봉 스캔 기본값 — Pine book_accum + 사용자 조정(느슨·RVOL 1.6·하락 40봉·6%) */

export const BOOK_ACCUM_MIN_CANDLES = 80;

export const BOOK_ACCUM_SERVER_DEFAULTS = {
  preset: "느슨",
  volLen: 20,
  minRvol: 1.6,
  needDrop: true,
  dropLb: 40,
  minDropPct: 6,
  needVolMaUp: true,
  useCost: true,
  costTolPct: 3.0,
  pivotLen: 5,
  recoverDays: 5,
  consecWin: 3,
  minConsec: 2,
  maxBodyPct: 45.0,
  allowSmallBull: true,
  minScore: 55,
  needCostCtx: false,
  riseLb: 30,
  minRisePct: 15.0,
  peakRvol: 2.5,
};
