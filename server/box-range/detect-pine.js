import { normalizeBoxUnixTime } from "./box-time.js";

/**
 * Pine `pine-horizontal-box-zones.pine` 의 `f_zoneEngine` (pctLimit=false 기본) 서버 포팅.
 * - request.security lookahead_off 기준: 마지막 미확정 봉 1개 제외하고 순차 처리.
 * - 저장 배열은 Pine과 동일하게 최신이 앞(unshift).
 *
 * @typedef {{ time: number; open: number; high: number; low: number; close: number }} Bar
 * @typedef {{
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   validBars: number;
 * }} DetectedBox
 */

const NO_PCT = 99999.0;
const MERGE_SCAN = 6;

/** Pine 프리셋 */
const PRESET = {
  "1h": {
    lb: 16,
    minB: 6,
    maxPct: 3.2,
    atrLen: 14,
    atrMult: 2.0,
    mergeMidPct: 1.0,
    mergeBars: 0,
    extBars: 10,
    exitBars: 2,
  },
  "4h": {
    lb: 14,
    minB: 5,
    maxPct: 4.5,
    atrLen: 14,
    atrMult: 2.0,
    mergeMidPct: 1.2,
    mergeBars: 0,
    extBars: 8,
    exitBars: 2,
  },
  "1d": {
    lb: 12,
    minB: 4,
    maxPct: 7.0,
    atrLen: 14,
    atrMult: 2.0,
    mergeMidPct: 1.5,
    mergeBars: 0,
    extBars: 6,
    exitBars: 2,
  },
};

function tfSec(timeframe) {
  if (timeframe === "1h") return 3600;
  if (timeframe === "4h") return 14400;
  return 86400;
}

function midDistancePct(t1, b1, t2, b2) {
  const m1 = (t1 + b1) * 0.5;
  const m2 = (t2 + b2) * 0.5;
  const ref = (m1 + m2) * 0.5;
  return ref > 0 ? (Math.abs(m1 - m2) / ref) * 100.0 : 100.0;
}

function timeNear(tEnd, tStart, mBars, tfSeconds) {
  const gap = mBars * tfSeconds * 1000;
  if (mBars <= 0) return true;
  return Math.abs(tStart - tEnd) <= gap;
}

function shouldMerge(tN, bN, t0N, t1N, tO, bO, t0O, t1O, maxMidPct, mBars, tfSeconds) {
  const midOk = midDistancePct(tN, bN, tO, bO) <= maxMidPct;
  const timeOk =
    timeNear(t1N, t0O, mBars, tfSeconds) || timeNear(t1O, t0N, mBars, tfSeconds);
  return midOk && timeOk;
}

function trimStore(zTop, zBot, zT0, zT1, maxN) {
  while (zTop.length > maxN) {
    zTop.pop();
    zBot.pop();
    zT0.pop();
    zT1.pop();
  }
}

function pushMerged(zTop, zBot, zT0, zT1, tN, bN, t0N, t1N, mPct, mBars, tfSeconds, maxN) {
  zTop.unshift(tN);
  zBot.unshift(bN);
  zT0.unshift(t0N);
  zT1.unshift(t1N);

  const scan = Math.min(MERGE_SCAN, zTop.length - 1);
  if (scan > 0) {
    for (let j = 1; j <= scan; j++) {
      const tO = zTop[j];
      const bO = zBot[j];
      const t0O = zT0[j];
      const t1O = zT1[j];
      if (shouldMerge(tN, bN, t0N, t1N, tO, bO, t0O, t1O, mPct, mBars, tfSeconds)) {
        const mt = Math.max(tN, tO);
        const mb = Math.min(bN, bO);
        const ma = Math.min(t0N, t0O);
        const me = Math.max(t1N, t1O);
        zTop[0] = mt;
        zBot[0] = mb;
        zT0[0] = ma;
        zT1[0] = me;
        zTop.splice(j, 1);
        zBot.splice(j, 1);
        zT0.splice(j, 1);
        zT1.splice(j, 1);
        break;
      }
    }
  }
  trimStore(zTop, zBot, zT0, zT1, maxN);
}

/**
 * Wilder RMA (ta.rma)
 * @param {number[]} values
 * @param {number} length
 */
function rmaSeries(values, length) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const n = Math.max(1, Math.floor(length || 1));
  let prev = values[0];
  out[0] = prev;
  const alpha = 1 / n;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    prev = prev + alpha * (v - prev);
    out[i] = prev;
  }
  return out;
}

/**
 * @param {Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxCount]
 * @returns {DetectedBox[]}
 */
export function detectBoxRangesPineOnCandles(candles, timeframe, maxCount = 5) {
  const p = PRESET[timeframe];
  if (!p) return [];
  if (!Array.isArray(candles) || candles.length < Math.max(20, p.lb + 3)) return [];

  // Pine 기본: usePctLimit=false, completedOnly=true, showActive=false
  const pctLimit = false;
  const useAtrCap = false;
  const breakAtrMult = 0.45;
  const capPct = pctLimit ? (useAtrCap ? p.maxPct : p.maxPct) : NO_PCT;

  const tfSeconds = tfSec(timeframe);
  const extMs = p.extBars * tfSeconds * 1000;

  // 마지막 미확정 봉 1개 제외(기존 detect-pro와 동일한 관례)
  const confirmedEnd = Math.max(0, candles.length - 2);

  // ATR 계산
  const tr = [];
  for (let i = 0; i <= confirmedEnd; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const v = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    tr.push(Number.isFinite(v) ? v : 0);
  }
  const atr = rmaSeries(tr, p.atrLen);

  // 상태 머신 (Pine var)
  let stT0 = null;
  let stCnt = 0;
  let looseCnt = 0;
  let stTop = null;
  let stBot = null;

  /** @type {number[]} */ const zTop = [];
  /** @type {number[]} */ const zBot = [];
  /** @type {number[]} */ const zT0 = [];
  /** @type {number[]} */ const zT1 = [];

  // 롤링 highest/lowest (lb)
  for (let i = 0; i <= confirmedEnd; i++) {
    const c = candles[i];
    const tMs = c.time;

    const lb = p.lb;
    const start = Math.max(0, i - lb + 1);
    let rngHi = candles[start].high;
    let rngLo = candles[start].low;
    for (let k = start + 1; k <= i; k++) {
      rngHi = Math.max(rngHi, candles[k].high);
      rngLo = Math.min(rngLo, candles[k].low);
    }
    const midPx = (rngHi + rngLo) * 0.5;
    const rangePct = midPx > 0 ? ((rngHi - rngLo) / midPx) * 100.0 : 100.0;
    const rollTight = pctLimit ? rangePct <= capPct : true;

    const atrVal = atr[i] ?? 0;
    const brkBuf = atrVal * breakAtrMult;

    const trkMid =
      stTop != null && stBot != null ? (stTop + stBot) * 0.5 : midPx;
    const trkPct =
      stTop != null && stBot != null && trkMid > 0
        ? ((stTop - stBot) / trkMid) * 100.0
        : rangePct;

    const pctWide = stCnt > 0 && pctLimit && trkPct > capPct * 1.25;
    const atrBreak =
      stCnt > 0 &&
      !pctLimit &&
      stTop != null &&
      stBot != null &&
      (c.close > stTop + brkBuf || c.close < stBot - brkBuf);
    const wideBreak = pctWide || atrBreak;
    const inBox = stCnt > 0 && !wideBreak;

    if (stCnt > 0) {
      looseCnt = pctLimit && !rollTight ? looseCnt + 1 : 0;
      if (wideBreak || (pctLimit && looseCnt >= p.exitBars)) {
        if (stCnt >= p.minB && stTop != null && stBot != null && stT0 != null) {
          pushMerged(
            zTop,
            zBot,
            zT0,
            zT1,
            stTop,
            stBot,
            stT0,
            tMs,
            p.mergeMidPct,
            p.mergeBars,
            tfSeconds,
            40, // maxStoreZones
          );
        }
        stT0 = null;
        stCnt = 0;
        looseCnt = 0;
        stTop = null;
        stBot = null;
      }
    }

    if (stCnt === 0 && rollTight) {
      stT0 = tMs;
      stCnt = 1;
      looseCnt = 0;
      stTop = c.high;
      stBot = c.low;
    } else if (stCnt > 0 && inBox) {
      stCnt += 1;
      stTop = Math.max(stTop ?? c.high, c.high);
      stBot = Math.min(stBot ?? c.low, c.low);
    }
  }

  /** @type {DetectedBox[]} */
  const out = [];
  const n = Math.min(zTop.length, zBot.length, zT0.length, zT1.length);
  for (let i = 0; i < n && out.length < maxCount; i++) {
    const top = zTop[i];
    const bottom = zBot[i];
    const t0 = zT0[i];
    const t1 = zT1[i] + extMs; // Pine draw 시점에 extMs 더함
    const leftTime = normalizeBoxUnixTime(t0);
    const rightTime = normalizeBoxUnixTime(t1);
    if (
      leftTime == null ||
      rightTime == null ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom) ||
      top <= bottom
    ) {
      continue;
    }
    out.push({
      top,
      bottom,
      mid: (top + bottom) * 0.5,
      leftTime,
      rightTime,
      validBars: 0, // Pine은 저장 개수/시각이 핵심. 봉수는 비교용으로 0 처리(필요 시 확장 가능)
    });
  }
  return out;
}

