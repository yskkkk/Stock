/** 세력 바닥·바람개비·상투 캔들 — Pine `pine-saeryeok-bottom-candle.pine` 포팅 */

import { candleTimeToDateKey } from "./golden-cross-detect.js";

/** @typedef {{
 *   preset?: "느슨"|"보통"|"엄격";
 *   tfAuto?: boolean;
 *   minScore?: number;
 *   maxBodyPct?: number;
 *   minGapPct?: number;
 *   volLen?: number;
 *   minRvol?: number;
 *   needDrop?: boolean;
 *   dropLookback?: number;
 *   minDropPct?: number;
 *   showBottom?: boolean;
 *   showBottomVar?: boolean;
 *   allowNoGap?: boolean;
 *   allowFallBull?: boolean;
 *   chartIsWeekly?: boolean;
 *   chartIsDaily?: boolean;
 * }} BottomCandleDetectOpts */

export const BOTTOM_CANDLE_MIN_CANDLES = 30;

export const BOTTOM_TAG_BY_CODE = {
  1: "바닥·전형",
  2: "바닥·갭변곡",
  3: "바닥·하락양",
  4: "바닥·갭하양",
  5: "바닥·무갭",
};

/**
 * @param {boolean} forWeekly
 * @param {BottomCandleDetectOpts} opts
 */
export function tuneBottomCandleParams(forWeekly, opts = {}) {
  const chartIsWeekly = Boolean(opts.chartIsWeekly);
  const chartIsDaily = Boolean(opts.chartIsDaily ?? !chartIsWeekly);
  const preset = opts.preset ?? "보통";
  const tfAuto = opts.tfAuto !== false;
  const volLen = opts.volLen ?? 20;
  const dropLookback = opts.dropLookback ?? 20;
  const minDropPct = opts.minDropPct ?? 3;
  const maxBodyPct = opts.maxBodyPct ?? 35;
  const minGapPct = opts.minGapPct ?? 0.3;
  const minRvol = opts.minRvol ?? 1.2;

  const bBase = forWeekly ? 38 : chartIsDaily ? 35 : 32;
  const gBase = forWeekly ? 0.12 : chartIsDaily ? 0.25 : 0.18;
  const vBase = forWeekly ? 12 : volLen;
  const rBase = forWeekly ? 1.1 : chartIsDaily ? 1.2 : 1.15;
  const dLb = forWeekly ? 26 : chartIsDaily ? 20 : dropLookback;
  const dPct = forWeekly ? 6 : chartIsDaily ? 3 : minDropPct;

  const bAdj =
    preset === "엄격" ? Math.min(bBase, 28) : preset === "느슨" ? bBase * 1.12 : bBase;
  const gAdj = preset === "엄격" ? Math.max(gBase, 0.4) : gBase;
  const rAdj =
    preset === "엄격"
      ? Math.max(rBase, 1.35)
      : preset === "느슨"
        ? Math.min(rBase, 1)
        : rBase;
  const dAdj =
    preset === "엄격" ? dPct * 1.15 : preset === "느슨" ? dPct * 0.75 : dPct;

  return {
    bodyMax: tfAuto ? bAdj : maxBodyPct,
    gapMin: tfAuto ? gAdj : minGapPct,
    volLen: tfAuto ? vBase : volLen,
    rvolMin: tfAuto ? rAdj : minRvol,
    dropLb: tfAuto ? dLb : dropLookback,
    dropMin: tfAuto ? dAdj : minDropPct,
  };
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number; volume?: number }>} candles
 * @param {number} period
 * @param {number} barIndex
 */
function volumeSmaAt(candles, period, barIndex) {
  if (barIndex < period - 1) return null;
  let sum = 0;
  for (let j = 0; j < period; j++) {
    const v = Number(candles[barIndex - j]?.volume);
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

/**
 * @param {Array<{ high?: number; low?: number }>} candles
 * @param {number} lookback
 * @param {number} barIndex
 */
function highestHigh(candles, lookback, barIndex) {
  let hi = -Infinity;
  const start = Math.max(0, barIndex - lookback + 1);
  for (let i = start; i <= barIndex; i++) {
    const h = Number(candles[i]?.high);
    if (Number.isFinite(h) && h > hi) hi = h;
  }
  return hi > -Infinity ? hi : null;
}

/**
 * @param {Array<{ high?: number; low?: number }>} candles
 * @param {number} lookback
 * @param {number} barIndex
 */
function lowestLow(candles, lookback, barIndex) {
  let lo = Infinity;
  const start = Math.max(0, barIndex - lookback + 1);
  for (let i = start; i <= barIndex; i++) {
    const l = Number(candles[i]?.low);
    if (Number.isFinite(l) && l < lo) lo = l;
  }
  return lo < Infinity ? lo : null;
}

/**
 * @param {Array<{ close?: number }>} candles
 * @param {number} period
 * @param {number} barIndex
 */
function closeSmaAt(candles, period, barIndex) {
  if (barIndex < period - 1) return null;
  let sum = 0;
  for (let j = 0; j < period; j++) {
    const cl = Number(candles[barIndex - j]?.close);
    if (!Number.isFinite(cl)) return null;
    sum += cl;
  }
  return sum / period;
}

/** @param {{ open?: number; high?: number; low?: number; close?: number }} c */
function rng(c) {
  const h = Number(c.high);
  const l = Number(c.low);
  return Number.isFinite(h) && Number.isFinite(l) ? h - l : 0;
}

/** @param {{ open?: number; close?: number }} c */
function body(c) {
  const o = Number(c.open);
  const cl = Number(c.close);
  return Number.isFinite(o) && Number.isFinite(cl) ? Math.abs(cl - o) : 0;
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 * @param {number} bodyMax
 */
function bodyPctOff(candles, barIndex, off, bodyMax) {
  const idx = barIndex - off;
  const c = candles[idx];
  if (!c) return bodyMax + 1;
  const r = rng(c);
  return r > 0 ? (body(c) / r) * 100 : 100;
}

/** @param {{ open?: number; close?: number }} c */
function isBull(c) {
  return Number(c.close) > Number(c.open);
}

/** @param {{ open?: number; close?: number }} c */
function isBear(c) {
  return Number(c.close) < Number(c.open);
}

/**
 * @param {Array<{ open?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 * @param {number} bodyMax
 */
function isInflection(candles, barIndex, off, bodyMax) {
  return bodyPctOff(candles, barIndex, off, bodyMax) <= bodyMax;
}

/**
 * @param {Array<{ open?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 * @param {number} gapMin
 */
function gapDn(candles, barIndex, off, gapMin) {
  const cur = candles[barIndex - off];
  const prev = candles[barIndex - off - 1];
  if (!cur || !prev) return false;
  const o = Number(cur.open);
  const pc = Number(prev.close);
  if (!Number.isFinite(o) || !Number.isFinite(pc)) return false;
  if (gapMin <= 0) return o < pc;
  if (pc <= 0) return false;
  return ((pc - o) / pc) * 100 >= gapMin;
}

/**
 * @param {Array<{ open?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 * @param {number} gapMin
 */
function gapUp(candles, barIndex, off, gapMin) {
  const cur = candles[barIndex - off];
  const prev = candles[barIndex - off - 1];
  if (!cur || !prev) return false;
  const o = Number(cur.open);
  const pc = Number(prev.close);
  if (!Number.isFinite(o) || !Number.isFinite(pc)) return false;
  if (gapMin <= 0) return o > pc;
  if (pc <= 0) return false;
  return ((o - pc) / pc) * 100 >= gapMin;
}

/**
 * @param {Array<{ open?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 */
function fallBull(candles, barIndex, off) {
  const cur = candles[barIndex - off];
  const prev = candles[barIndex - off - 1];
  if (!cur || !prev) return false;
  return Number(cur.open) < Number(prev.close) && isBull(cur);
}

/**
 * @param {Array<{ open?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} off
 */
function riseBear(candles, barIndex, off) {
  const cur = candles[barIndex - off];
  const prev = candles[barIndex - off - 1];
  if (!cur || !prev) return false;
  return Number(cur.open) > Number(prev.close) && isBear(cur);
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number }>} candles
 * @param {number} barIndex
 * @param {number} gapMin
 */
function gapStory(candles, barIndex, gapMin) {
  const cur = candles[barIndex];
  const prev1 = candles[barIndex - 1];
  const prev2 = candles[barIndex - 2];
  const gDual = gapDn(candles, barIndex, 1, gapMin) && gapUp(candles, barIndex, 0, gapMin);
  const gAny = gapDn(candles, barIndex, 1, gapMin) || gapUp(candles, barIndex, 0, gapMin);
  const gBreak =
    cur &&
    prev1 &&
    Number.isFinite(Number(cur.close)) &&
    Number.isFinite(Number(prev1.high)) &&
    Number(cur.close) > Number(prev1.high);
  const gTri =
    prev1 &&
    prev2 &&
    cur &&
    Number(prev1.low) <= Number(prev2.low) &&
    Number(prev1.low) <= Number(cur.low);
  const gapOk = Boolean(gDual || gAny || gBreak || gTri);
  return { gDual, gAny, gBreak, gTri, gapOk };
}

/**
 * @param {boolean} anyB
 * @param {number} tagCode
 * @param {{ gDual: boolean; gAny: boolean; gBreak: boolean; gTri: boolean }} gap
 * @param {number} rvol0
 * @param {number} rvolMin
 * @param {number} body2
 * @param {number} bodyMax
 * @param {number} dropPct
 * @param {number} dropMin
 */
function scoreBottom(
  anyB,
  tagCode,
  gap,
  rvol0,
  rvolMin,
  body2,
  bodyMax,
  dropPct,
  dropMin,
) {
  let sc = 0;
  if (!anyB) return 0;
  sc += gap.gDual ? 25 : gap.gAny ? 12 : 0;
  sc += gap.gBreak ? 20 : 0;
  sc += gap.gTri ? 10 : 0;
  sc += Math.min(25, (rvol0 / Math.max(rvolMin, 0.5)) * 15);
  sc +=
    body2 <= bodyMax
      ? Math.min(15, ((bodyMax - body2) / Math.max(bodyMax, 1)) * 15)
      : 0;
  sc +=
    dropPct >= dropMin
      ? Math.min(10, (dropPct / Math.max(dropMin, 0.1)) * 8)
      : 0;
  sc += tagCode === 1 ? 8 : tagCode === 2 ? 5 : tagCode === 5 ? 4 : 2;
  return Math.min(100, sc);
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number; volume?: number; time?: unknown }>} candles
 * @param {number} [barIndex]
 * @param {BottomCandleDetectOpts} [opts]
 */
export function detectBottomCandleAtBar(candles, barIndex = candles.length - 1, opts = {}) {
  const empty = {
    anyBottom: false,
    bottomClassic: false,
    tagCode: 0,
    tag: "",
    score: 0,
    signalDate: null,
    slPrice: null,
    zoneTop: null,
    zoneBot: null,
    rvol: null,
  };
  if (!Array.isArray(candles) || candles.length < BOTTOM_CANDLE_MIN_CANDLES) return empty;
  if (barIndex < 2 || barIndex >= candles.length) return empty;

  const tuned = tuneBottomCandleParams(Boolean(opts.chartIsWeekly), opts);
  const {
    bodyMax,
    gapMin,
    volLen,
    rvolMin,
    dropLb,
    dropMin,
  } = tuned;

  const needDrop = opts.needDrop !== false;
  const showBottom = opts.showBottom !== false;
  const showBottomVar = opts.showBottomVar !== false;
  const allowNoGap = opts.allowNoGap !== false;
  const allowFallBull = opts.allowFallBull !== false;
  const minScore = opts.minScore ?? 50;

  const volMa0 = volumeSmaAt(candles, volLen, barIndex);
  const vol0 = Number(candles[barIndex]?.volume);
  const rvol0 =
    volMa0 != null && volMa0 > 0 && Number.isFinite(vol0) ? vol0 / volMa0 : 1;

  const avgRef = closeSmaAt(candles, dropLb, barIndex);
  const loRef = lowestLow(candles, dropLb, barIndex);
  const close0 = Number(candles[barIndex]?.close);
  const dropPct0 =
    avgRef != null && avgRef > 0 && Number.isFinite(close0)
      ? ((avgRef - close0) / avgRef) * 100
      : 0;
  const risePct0 =
    loRef != null && loRef > 0 && Number.isFinite(close0)
      ? ((close0 - loRef) / loRef) * 100
      : 0;

  const hadDrop0 = dropPct0 >= dropMin;
  const ctxDrop = !needDrop || hadDrop0;

  const gap = gapStory(candles, barIndex, gapMin);
  const body2 = bodyPctOff(candles, barIndex, 1, bodyMax);

  const c0 = candles[barIndex];
  const c1 = candles[barIndex - 1];
  const c2 = candles[barIndex - 2];
  if (!c0 || !c1 || !c2) return empty;

  const pivot2 =
    isInflection(candles, barIndex, 1, bodyMax) ||
    (allowFallBull && fallBull(candles, barIndex, 1));

  const bClassic =
    showBottom &&
    ctxDrop &&
    isBear(c2) &&
    pivot2 &&
    isBull(c0);

  const bNoGap =
    showBottomVar &&
    allowNoGap &&
    ctxDrop &&
    isBear(c2) &&
    pivot2 &&
    isBull(c0);

  const bGapPivot =
    showBottomVar &&
    ctxDrop &&
    isBear(c2) &&
    pivot2 &&
    gapUp(candles, barIndex, 1, gapMin) &&
    isBull(c0) &&
    gapUp(candles, barIndex, 0, gapMin);

  const bFallBull =
    showBottomVar &&
    allowFallBull &&
    ctxDrop &&
    isBear(c2) &&
    fallBull(candles, barIndex, 1) &&
    isBull(c0);

  const bGapFallBull =
    showBottomVar &&
    allowFallBull &&
    ctxDrop &&
    isBear(c2) &&
    fallBull(candles, barIndex, 1) &&
    fallBull(candles, barIndex, 0);

  const anyB = bClassic || bNoGap || bGapPivot || bFallBull || bGapFallBull;

  let tagCode = 0;
  if (bClassic && gap.gDual) tagCode = 1;
  else if (bClassic) tagCode = 5;
  else if (bGapPivot) tagCode = 2;
  else if (bFallBull) tagCode = 3;
  else if (bGapFallBull) tagCode = 4;
  else if (bNoGap) tagCode = 5;

  const scoreRaw = scoreBottom(
    anyB,
    tagCode,
    gap,
    rvol0,
    rvolMin,
    body2,
    bodyMax,
    dropPct0,
    dropMin,
  );

  const passScore = scoreRaw >= minScore;
  const anyBottom = anyB && passScore;
  const bottomClassic = anyBottom && bClassic;

  const slL = Number(c1.low);
  const zoneTop = Number(c0.close);
  const zoneBot = Number.isFinite(slL) ? slL : null;

  return {
    anyBottom,
    bottomClassic,
    tagCode: anyBottom ? tagCode : 0,
    tag: anyBottom
      ? (BOTTOM_TAG_BY_CODE[/** @type {keyof typeof BOTTOM_TAG_BY_CODE} */ (tagCode)] ??
          "")
      : "",
    score: anyBottom ? Math.round(scoreRaw) : 0,
    signalDate: anyBottom ? candleTimeToDateKey(c0.time) : null,
    slPrice: anyBottom && Number.isFinite(slL) ? slL : null,
    zoneTop: anyBottom && Number.isFinite(zoneTop) ? zoneTop : null,
    zoneBot,
    rvol: anyBottom ? rvol0 : null,
    dropPct: anyBottom ? dropPct0 : null,
    risePct: risePct0,
  };
}

/**
 * @param {Array<{ open?: number; high?: number; low?: number; close?: number; volume?: number; time?: unknown }>} candles
 * @param {BottomCandleDetectOpts} [opts]
 */
export function detectBottomCandleLatest(candles, opts = {}) {
  return detectBottomCandleAtBar(candles, candles.length - 1, opts);
}
