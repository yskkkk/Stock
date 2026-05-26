/**
 * 통합 박스권 PRO — Pine `pine-box-range-pro.pine` · `detect-pro.js` 공통 SSOT
 *
 * 1단계: 종가 백분위 밴드(90/10) · 상·하단 거절(반등) 터치 · 중심가 근접 병합
 * 3단계: 구간 VWAP(거래량 없으면 typical median) 중심 · 확장 시 슬라이스 재계산 · 중심 이탈 시 가로 중단
 */

import {
  BOX_RANGE_EXPAND_EDGE_PCT,
  BOX_RANGE_EXPAND_GAP_BARS,
  BOX_RANGE_MAX_EXPAND_BARS,
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_PRO_BAND_HIGH_PCT,
  BOX_RANGE_PRO_BAND_LOW_PCT,
  BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT,
  BOX_RANGE_PRO_MERGE_MID_PCT,
  BOX_RANGE_PRO_MIN_REJECTIONS,
  BOX_RANGE_PRO_REJECT_CLOSE_FRAC,
  BOX_RANGE_PRO_SPLIT_MID_PCT,
  BOX_RANGE_TOUCH_THRESHOLD,
} from "./constants.js";
import { normalizeBoxUnixTime } from "./box-time.js";

/** @param {number} l1 @param {number} r1 @param {number} l2 @param {number} r2 @param {number} gapSec */
export function timesNearOverlap(l1, r1, l2, r2, gapSec) {
  return l1 <= r2 + gapSec && l2 <= r1 + gapSec;
}

/**
 * @typedef {{ time: number; open: number; high: number; low: number; close: number; volume?: number }} Bar
 * @typedef {{
 *   top: number;
 *   bottom: number;
 *   mid: number;
 *   leftTime: number;
 *   rightTime: number;
 *   validBars: number;
 * }} DetectedBox
 */

/** @param {Bar} bar */
export function typicalPrice(bar) {
  return (bar.high + bar.low + bar.close) / 3;
}

/**
 * @param {number[]} values
 * @param {number} p 0–100
 */
export function percentileLinear(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * @param {Bar[]} candles
 * @param {number} rightIdx
 * @param {number} leftIdx
 */
export function computeBoxFromSlice(candles, rightIdx, leftIdx) {
  /** @type {number[]} */
  const closes = [];
  let pv = 0;
  let volSum = 0;
  /** @type {number[]} */
  const typicals = [];

  for (let i = rightIdx; i <= leftIdx; i++) {
    const c = candles[i];
    closes.push(c.close);
    const tp = typicalPrice(c);
    typicals.push(tp);
    const v = Number(c.volume);
    if (Number.isFinite(v) && v > 0) {
      pv += tp * v;
      volSum += v;
    }
  }

  let top = percentileLinear(closes, BOX_RANGE_PRO_BAND_HIGH_PCT);
  let bottom = percentileLinear(closes, BOX_RANGE_PRO_BAND_LOW_PCT);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
    return { top: NaN, bottom: NaN, mid: NaN };
  }
  if (top <= bottom) {
    top = Math.max(...closes);
    bottom = Math.min(...closes);
  }

  let mid;
  if (volSum > 0) {
    mid = pv / volSum;
  } else {
    mid = percentileLinear(typicals, 50);
  }
  mid = Math.max(bottom, Math.min(top, mid));

  return { top, bottom, mid };
}

/**
 * @param {Bar} bar
 * @param {number} top
 * @param {number} bot
 * @param {number} pad
 */
export function barInBand(bar, top, bot, pad) {
  return bar.high <= top + pad && bar.low >= bot - pad;
}

/**
 * @param {Bar} bar
 * @param {number} mid
 * @param {number} top
 * @param {number} bot
 * @param {number} splitPct
 */
export function barNearMid(bar, mid, top, bot, splitPct) {
  const halfH = (top - bot) * 0.5;
  if (halfH <= 1e-12) return true;
  return Math.abs(bar.close - mid) <= (splitPct / 100) * halfH;
}

/**
 * @param {Bar} bar
 * @param {number} top
 * @param {number} bot
 * @param {number} mid
 * @param {number} pad
 * @param {number} splitPct
 */
export function barCanExtend(bar, top, bot, mid, pad, splitPct) {
  return barInBand(bar, top, bot, pad) && barNearMid(bar, mid, top, bot, splitPct);
}

/**
 * @param {Bar[]} candles
 * @param {number} seedLeft
 * @param {number} seedRight
 * @param {number} maxBars
 * @param {number} pad
 * @param {number} gapAllow
 * @param {number} splitPct
 */
export function expandRangeIdxPro(
  candles,
  seedOldest,
  seedNewest,
  maxBars,
  pad,
  gapAllow,
  splitPct,
) {
  let newestIdx = seedNewest;
  let oldestIdx = seedOldest;
  let miss = 0;
  const lim = Math.min(maxBars, candles.length - 1);

  if (seedOldest < lim) {
    for (let i = seedOldest + 1; i <= lim; i++) {
      const { top, bottom, mid } = computeBoxFromSlice(
        candles,
        oldestIdx,
        i,
      );
      if (
        Number.isFinite(top) &&
        barCanExtend(candles[i], top, bottom, mid, pad, splitPct)
      ) {
        newestIdx = i;
        miss = 0;
      } else {
        miss += 1;
        if (miss >= gapAllow) break;
      }
    }
  }

  miss = 0;
  for (let i = seedNewest - 1; i >= 0; i--) {
    const { top, bottom, mid } = computeBoxFromSlice(
      candles,
      i,
      newestIdx,
    );
    if (
      Number.isFinite(top) &&
      barCanExtend(candles[i], top, bottom, mid, pad, splitPct)
    ) {
      oldestIdx = i;
      miss = 0;
    } else {
      miss += 1;
      if (miss >= gapAllow) break;
    }
  }

  return [newestIdx, oldestIdx];
}

/**
 * @param {Bar[]} candles
 * @param {number} rightIdx
 * @param {number} leftIdx
 * @param {number} top
 * @param {number} bottom
 */
export function countRejections(candles, rightIdx, leftIdx, top, bottom) {
  const h = top - bottom;
  const th = h * BOX_RANGE_TOUCH_THRESHOLD;
  const mid = (top + bottom) * 0.5;
  const push = th * BOX_RANGE_PRO_REJECT_CLOSE_FRAC;
  let topReject = 0;
  let bottomReject = 0;

  for (let i = rightIdx; i <= leftIdx; i++) {
    const c = candles[i];
    // 상·하단 터치 후 종가가 중심 반대편 — 거절(반등)
    if (c.high >= top - th && c.close < mid) topReject += 1;
    if (c.low <= bottom + th && c.close > mid) bottomReject += 1;
  }

  return { topReject, bottomReject };
}

/**
 * @param {number} t1
 * @param {number} b1
 * @param {number} t2
 * @param {number} b2
 */
export function midDistancePct(t1, b1, t2, b2) {
  const m1 = (t1 + b1) * 0.5;
  const m2 = (t2 + b2) * 0.5;
  const ref = (m1 + m2) * 0.5;
  if (ref <= 0) return 100;
  return (Math.abs(m1 - m2) / ref) * 100;
}

/** @param {number} t @param {number} b */
export function boxHeightPct(t, b) {
  const m = (t + b) * 0.5;
  return m > 0 ? ((t - b) / m) * 100 : 100;
}

/**
 * PRO 병합: 중심·시간·높이 유사 (가격 겹침만으로는 합치지 않음)
 * @param {{ top: number; bottom: number; leftTime: number; rightTime: number }} a
 * @param {{ top: number; bottom: number; leftTime: number; rightTime: number }} b
 * @param {number} barSec
 * @param {number} [mergeBarsGap]
 * @param {number} [mergeMidPct]
 */
export function shouldMergeProBoxes(
  a,
  b,
  barSec,
  mergeBarsGap = 5,
  mergeMidPct = BOX_RANGE_PRO_MERGE_MID_PCT,
) {
  const gap = mergeBarsGap * barSec;
  const timeOk = timesNearOverlap(
    a.leftTime,
    a.rightTime,
    b.leftTime,
    b.rightTime,
    gap,
  );
  const midOk =
    midDistancePct(a.top, a.bottom, b.top, b.bottom) <= mergeMidPct;
  const hOk =
    Math.abs(boxHeightPct(a.top, a.bottom) - boxHeightPct(b.top, b.bottom)) <=
    BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT;
  return timeOk && midOk && hOk;
}

/** @param {"1h"|"4h"|"1d"} timeframe */
export function splitMidPctForTimeframe(timeframe) {
  return BOX_RANGE_PRO_SPLIT_MID_PCT[timeframe] ?? 48;
}

/**
 * @param {Bar[]} candles
 * @param {number} endIdx
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {{ box: DetectedBox; startIdx: number } | null}
 */
export function detectBoxRangeProAt(candles, endIdx, timeframe) {
  const end = endIdx;
  if (end < 1 || end >= candles.length) return null;

  const maxPct = BOX_RANGE_MAX_PCT[timeframe] ?? 15;
  const splitPct = splitMidPctForTimeframe(timeframe);
  const lookback = Math.min(BOX_RANGE_MAX_EXPAND_BARS, end);

  let maxVal = candles[end].high;
  let minVal = candles[end].low;
  let validCount = 1;
  let startIdx = end;

  for (let i = 1; i <= lookback; i++) {
    const idx = end - i;
    if (idx < 0) break;
    const c = candles[idx];
    maxVal = Math.max(maxVal, c.high);
    minVal = Math.min(minVal, c.low);
    const rangePct =
      minVal > 0 ? ((maxVal - minVal) / minVal) * 100 : 100;
    if (rangePct > maxPct) break;
    validCount += 1;
    startIdx = idx;
  }

  if (validCount < BOX_RANGE_MIN_BARS) return null;

  const seedH = maxVal - minVal;
  const pad = seedH * (BOX_RANGE_EXPAND_EDGE_PCT / 100);
  const [newestIdx, oldestIdx] = expandRangeIdxPro(
    candles,
    startIdx,
    end,
    lookback,
    pad,
    BOX_RANGE_EXPAND_GAP_BARS,
    splitPct,
  );

  const { top: boxTop, bottom: boxBot, mid } = computeBoxFromSlice(
    candles,
    oldestIdx,
    newestIdx,
  );
  if (
    !Number.isFinite(boxTop) ||
    !Number.isFinite(boxBot) ||
    !Number.isFinite(mid) ||
    boxTop <= boxBot
  ) {
    return null;
  }

  const { topReject, bottomReject } = countRejections(
    candles,
    oldestIdx,
    newestIdx,
    boxTop,
    boxBot,
  );
  if (
    topReject < BOX_RANGE_PRO_MIN_REJECTIONS ||
    bottomReject < BOX_RANGE_PRO_MIN_REJECTIONS
  ) {
    return null;
  }

  const leftTime = normalizeBoxUnixTime(candles[oldestIdx].time);
  const rightTime = normalizeBoxUnixTime(candles[newestIdx].time);
  if (leftTime == null || rightTime == null) return null;

  return {
    box: {
      top: boxTop,
      bottom: boxBot,
      mid,
      leftTime,
      rightTime,
      validBars: newestIdx - oldestIdx + 1,
    },
    startIdx: oldestIdx,
  };
}

/**
 * @param {Bar[]} candles — 마지막 미확정 봉 제외 권장
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxCount]
 * @returns {DetectedBox[]}
 */
export function detectBoxRangesProOnCandles(
  candles,
  timeframe,
  maxCount = 5,
) {
  if (!Array.isArray(candles) || candles.length < BOX_RANGE_MIN_BARS + 2) {
    return [];
  }
  /** @type {DetectedBox[]} */
  const results = [];
  let searchEnd = candles.length - 2;

  while (
    results.length < maxCount &&
    searchEnd >= BOX_RANGE_MIN_BARS + 1
  ) {
    const result = detectBoxRangeProAt(candles, searchEnd, timeframe);
    if (result) {
      results.push(result.box);
      searchEnd = result.startIdx - 1;
    } else {
      searchEnd -= Math.ceil(BOX_RANGE_MAX_EXPAND_BARS / 2);
    }
  }
  return results;
}
