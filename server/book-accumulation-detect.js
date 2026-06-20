/** 책 06~07장 매집봉 — Pine `pine-book-accumulation.pine` 포팅 */

import { candleTimeToDateKey } from "./golden-cross-detect.js";
import {
  BOOK_ACCUM_MIN_CANDLES,
  BOOK_ACCUM_SERVER_DEFAULTS,
} from "./book-accumulation/constants.js";

export { BOOK_ACCUM_MIN_CANDLES, BOOK_ACCUM_SERVER_DEFAULTS };

/** @typedef {typeof BOOK_ACCUM_SERVER_DEFAULTS & Record<string, unknown>} BookAccumDetectOpts */

/**
 * @param {BookAccumDetectOpts} [opts]
 */
function resolveOpts(opts = {}) {
  return { ...BOOK_ACCUM_SERVER_DEFAULTS, ...opts };
}

/** @param {"느슨"|"보통"|"엄격"} preset @param {number} minRvol */
export function resolveBookAccumEffRvol(preset, minRvol) {
  if (preset === "엄격") return Math.max(minRvol, 2.2);
  return minRvol;
}

/** @param {"느슨"|"보통"|"엄격"} preset @param {number} minConsec */
function resolveEffConsec(preset, minConsec) {
  if (preset === "엄격") return Math.max(minConsec, 2);
  return minConsec;
}

/** @param {"느슨"|"보통"|"엄격"} preset @param {number} minScore */
function resolveEffMinScore(preset, minScore) {
  if (preset === "느슨") return Math.min(minScore, 45);
  if (preset === "엄격") return Math.max(minScore, 65);
  return minScore;
}

/**
 * @param {Array<{ volume?: number }>} candles
 * @param {number} volLen
 */
function volSma(candles, volLen) {
  const out = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const v = Number(candles[i]?.volume) || 0;
    sum += v;
    if (i >= volLen) sum -= Number(candles[i - volLen]?.volume) || 0;
    if (i >= volLen - 1) out[i] = sum / volLen;
  }
  return out;
}

/**
 * @param {Array<{ high?: number }>} candles
 * @param {number} lb
 * @param {number} i
 */
function highestHigh(candles, lb, i) {
  let hi = -Infinity;
  for (let j = Math.max(0, i - lb + 1); j <= i; j++) {
    const h = Number(candles[j]?.high);
    if (Number.isFinite(h)) hi = Math.max(hi, h);
  }
  return Number.isFinite(hi) ? hi : 0;
}

/**
 * @param {Array<{ low?: number }>} candles
 * @param {number} lb
 * @param {number} i
 */
function lowestLow(candles, lb, i) {
  let lo = Infinity;
  for (let j = Math.max(0, i - lb + 1); j <= i; j++) {
    const l = Number(candles[j]?.low);
    if (Number.isFinite(l)) lo = Math.min(lo, l);
  }
  return Number.isFinite(lo) ? lo : 0;
}

/**
 * @param {Array<{ low?: number }>} candles
 * @param {number} bi
 * @param {number} len
 */
function pivotLowValue(candles, bi, len) {
  const pivotBar = bi - len;
  if (pivotBar < len) return null;
  const pl = Number(candles[pivotBar]?.low);
  if (!Number.isFinite(pl)) return null;
  for (let j = pivotBar - len; j <= pivotBar + len; j++) {
    if (j < 0 || j >= candles.length) return null;
    const l = Number(candles[j]?.low);
    if (Number.isFinite(l) && l < pl - 1e-12) return null;
  }
  return pl;
}

/** @param {{ open?: number; high?: number; low?: number; close?: number }} c */
function candleShape(c) {
  const high = Number(c?.high);
  const low = Number(c?.low);
  const open = Number(c?.open);
  const close = Number(c?.close);
  const rng = high - low;
  if (!Number.isFinite(rng) || rng <= 0) {
    return { bodyPct: 100, isSmallBull: false };
  }
  const body = Math.abs(close - open);
  return {
    bodyPct: (body / rng) * 100,
    isSmallBull: close > open,
  };
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number; volume?: number; time?: unknown }>} candles
 * @param {BookAccumDetectOpts} [opts]
 */
export function detectBookAccumulationLatest(candles, opts = {}) {
  const o = resolveOpts(opts);
  if (!Array.isArray(candles) || candles.length < BOOK_ACCUM_MIN_CANDLES) {
    return { anyAccum: false, score: 0, rvol: null, signalDate: null };
  }

  const volMa = volSma(candles, o.volLen);
  const effRvol = resolveBookAccumEffRvol(o.preset, o.minRvol);
  const effConsec = resolveEffConsec(o.preset, o.minConsec);
  const effMinScore = resolveEffMinScore(o.preset, o.minScore);

  let costBasis = null;
  let costTouches = 0;
  let breachBar = null;
  let prevTouchCost = false;

  /** @type {{ anyAccum: boolean; score: number; rvol: number | null; signalDate: string | null }} */
  let lastHit = { anyAccum: false, score: 0, rvol: null, signalDate: null };

  for (let bi = 0; bi < candles.length; bi++) {
    const c = candles[bi];
    const volMa0 = volMa[bi] || 0;
    const volume = Number(c?.volume) || 0;
    const rvol = volMa0 > 0 ? volume / volMa0 : 1;
    const volMaUp = bi >= 3 && volMa[bi] > volMa[bi - 3];

    const { bodyPct, isSmallBull } = candleShape(c);
    const hiRef = highestHigh(candles, o.dropLb, bi);
    const close = Number(c?.close) || 0;
    const dropPct = hiRef > 0 ? ((hiRef - close) / hiRef) * 100 : 0;
    const hadDrop = dropPct >= o.minDropPct;

    const loRise = lowestLow(candles, o.riseLb, bi);
    const risePct = loRise > 0 ? ((close - loRise) / loRise) * 100 : 0;
    const hadRise = risePct >= o.minRisePct;

    const plVal = o.useCost ? pivotLowValue(candles, bi, o.pivotLen) : null;
    if (o.useCost && plVal != null) {
      const pivotBar = bi - o.pivotLen;
      const plRvol =
        volMa[pivotBar] > 0
          ? (Number(candles[pivotBar]?.volume) || 0) / volMa[pivotBar]
          : 1;
      const hiRefPl = highestHigh(candles, o.dropLb, pivotBar);
      const closePl = Number(candles[pivotBar]?.close) || 0;
      const plDrop = hiRefPl > 0 ? ((hiRefPl - closePl) / hiRefPl) * 100 : 0;
      const plDropOk = !o.needDrop || plDrop >= o.minDropPct * 0.75;
      if (plRvol >= effRvol * 0.9 && plDropOk) costBasis = plVal;
    }

    const low = Number(c?.low) || 0;
    const high = Number(c?.high) || 0;
    const touchCost =
      o.useCost &&
      costBasis != null &&
      costBasis > 0 &&
      low <= costBasis * (1 + o.costTolPct / 100) &&
      high >= costBasis * (1 - o.costTolPct / 100);

    if (touchCost && !prevTouchCost) costTouches += 1;
    prevTouchCost = Boolean(touchCost);

    if (o.useCost && costBasis != null && close < costBasis) {
      const prevClose = bi > 0 ? Number(candles[bi - 1]?.close) : NaN;
      if (breachBar == null || (Number.isFinite(prevClose) && prevClose >= costBasis)) {
        breachBar = bi;
      }
    }
    if (o.useCost && costBasis != null && close >= costBasis) {
      breachBar = null;
    }

    const sinceBreach = breachBar != null ? bi - breachBar : 10000;
    const recover5d =
      o.useCost &&
      costBasis != null &&
      sinceBreach > 0 &&
      sinceBreach <= o.recoverDays &&
      close > costBasis;

    const shapeSmall = bodyPct <= o.maxBodyPct;
    const shapeSmallBull =
      o.allowSmallBull && isSmallBull && bodyPct <= o.maxBodyPct * 0.85;
    const shapeOk = shapeSmall || shapeSmallBull;

    const volOk =
      rvol >= effRvol &&
      (!o.needVolMaUp || volMaUp || rvol >= effRvol * 1.2);
    const open = Number(c?.open) || 0;
    const peakDistrib =
      hadRise && rvol >= o.peakRvol && close > open && bodyPct >= 55;
    const accumRaw = volOk && shapeOk && !peakDistrib && (!o.needDrop || hadDrop);

    let consecCnt = 0;
    for (let j = 0; j < o.consecWin; j++) {
      const idx = bi - j;
      if (idx < 0) break;
      const arv = volMa[idx] > 0 ? (Number(candles[idx]?.volume) || 0) / volMa[idx] : 1;
      const sh = candleShape(candles[idx]);
      const ash =
        sh.bodyPct <= o.maxBodyPct ||
        (o.allowSmallBull && sh.isSmallBull && sh.bodyPct <= o.maxBodyPct * 0.85);
      if (arv >= effRvol * 0.92 && ash) consecCnt += 1;
    }
    const consecOk = consecCnt >= effConsec;
    const ctxOk = !o.needCostCtx || touchCost || recover5d;

    let score = 0;
    if (accumRaw && ctxOk) {
      score += Math.min(30, (rvol / effRvol) * 18);
      score += shapeSmall ? 10 : 6;
      if (o.needVolMaUp && volMaUp) score += 12;
      if (touchCost) score += 20;
      if (recover5d) score += 15;
      if (consecOk) score += 12;
      score += costTouches >= 2 ? 10 : costTouches >= 1 ? 5 : 0;
      score = Math.min(100, score);
    }

    const anyAccum = accumRaw && ctxOk && score >= effMinScore;
    if (bi === candles.length - 1) {
      lastHit = {
        anyAccum,
        score: anyAccum ? Math.round(score) : 0,
        rvol: anyAccum ? Math.round(rvol * 100) / 100 : null,
        signalDate: anyAccum ? candleTimeToDateKey(c.time) : null,
      };
    }
  }

  return lastHit;
}
