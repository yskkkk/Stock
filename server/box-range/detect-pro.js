import {
  BOX_RANGE_EXPAND_EDGE_PCT,
  BOX_RANGE_EXPAND_GAP_BARS,
  BOX_RANGE_MAX_EXPAND_BARS,
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_MIN_TOUCHES,
  BOX_RANGE_TOUCH_THRESHOLD,
} from "./constants.js";

/**
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
 * @param {Bar[]} candles
 * @param {number} seedLeft
 * @param {number} seedRight
 * @param {number} top
 * @param {number} bot
 * @param {number} maxBars
 * @param {number} pad
 * @param {number} gapAllow
 */
export function expandRangeIdx(
  candles,
  seedLeft,
  seedRight,
  top,
  bot,
  maxBars,
  pad,
  gapAllow,
) {
  let leftIdx = seedLeft;
  let rightIdx = seedRight;
  let miss = 0;
  const lim = Math.min(maxBars, candles.length - 1);
  if (seedLeft < lim) {
    for (let i = seedLeft + 1; i <= lim; i++) {
      if (barInBand(candles[i], top, bot, pad)) {
        leftIdx = i;
        miss = 0;
      } else {
        miss += 1;
        if (miss >= gapAllow) break;
      }
    }
  }
  miss = 0;
  for (let i = seedRight - 1; i >= 0; i--) {
    if (barInBand(candles[i], top, bot, pad)) {
      rightIdx = i;
      miss = 0;
    } else {
      miss += 1;
      if (miss >= gapAllow) break;
    }
  }
  return [leftIdx, rightIdx];
}

/**
 * @param {Bar[]} candles
 * @param {number} leftIdx
 * @param {number} rightIdx
 */
export function recalcBoxPrices(candles, leftIdx, rightIdx) {
  let t = candles[rightIdx].high;
  let b = candles[rightIdx].low;
  for (let i = rightIdx + 1; i <= leftIdx; i++) {
    t = Math.max(t, candles[i].high);
    b = Math.min(b, candles[i].low);
  }
  const mid = (t + b) * 0.5;
  return { top: t, bottom: b, mid };
}

/**
 * Pine PRO 시드(폭% 끊김) + 좌우 확장 + 상·하단 터치
 * @param {Bar[]} candles
 * @param {number} endIdx — 앵커(확정봉) 인덱스
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {{ box: DetectedBox; startIdx: number } | null}
 */
export function detectBoxRangeProAt(candles, endIdx, timeframe) {
  const end = endIdx;
  if (end < 1 || end >= candles.length) return null;

  const maxPct = BOX_RANGE_MAX_PCT[timeframe] ?? 15;
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

  const seedTop = maxVal;
  const seedBot = minVal;
  const pad = (seedTop - seedBot) * (BOX_RANGE_EXPAND_EDGE_PCT / 100);
  const [leftIdx, rightIdx] = expandRangeIdx(
    candles,
    startIdx,
    end,
    seedTop,
    seedBot,
    lookback,
    pad,
    BOX_RANGE_EXPAND_GAP_BARS,
  );
  const { top: boxTop, bottom: boxBot, mid } = recalcBoxPrices(
    candles,
    leftIdx,
    rightIdx,
  );
  const threshold = (boxTop - boxBot) * BOX_RANGE_TOUCH_THRESHOLD;
  let topTouch = 0;
  let bottomTouch = 0;
  for (let i = rightIdx; i <= leftIdx; i++) {
    const c = candles[i];
    if (c.high >= boxTop - threshold) topTouch += 1;
    if (c.low <= boxBot + threshold) bottomTouch += 1;
  }
  if (topTouch < BOX_RANGE_MIN_TOUCHES || bottomTouch < BOX_RANGE_MIN_TOUCHES) {
    return null;
  }

  return {
    box: {
      top: boxTop,
      bottom: boxBot,
      mid,
      leftTime: candles[rightIdx].time,
      rightTime: candles[leftIdx].time,
      validBars: leftIdx - rightIdx + 1,
    },
    startIdx: leftIdx,
  };
}

/**
 * @param {Bar[]} candles — 미확정 마지막 봉 제외
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
