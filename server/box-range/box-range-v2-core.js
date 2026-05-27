/**
 * 박스권 탐지 V2 — 개선된 정밀 탐지
 *
 * PRO v1 대비 3가지 핵심 개선:
 *  1. ER(효율비) 필터  — 추세 중 쉬어가기 박스 제거
 *  2. 고저 퍼센타일   — top=고가80%, bottom=저가20% (종가 대신 윅 포함)
 *  3. 거래량 POC      — mid = 최대 거래량 가격대 (VWAP 대신)
 *  4. 거절 강도 스코어 — 횟수 카운트 → 거래량×되돌림 가중 점수
 */

import {
  boxHeightPct,
} from "./box-range-pro-core.js";
import { normalizeBoxUnixTime } from "./box-time.js";
import {
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_PCT,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_MAX_EXPAND_BARS,
  BOX_RANGE_EXPAND_EDGE_PCT,
  BOX_RANGE_EXPAND_GAP_BARS,
  BOX_RANGE_PRO_SPLIT_MID_PCT,
} from "./constants.js";

// ── V2 파라미터 ────────────────────────────────────────────────────────────
export const V2_ER_THRESHOLD      = 0.40;  // 효율비 상한 (0=완전횡보, 1=완전추세)
export const V2_BAND_HIGH_PCT     = 80;    // 고가 퍼센타일 → top
export const V2_BAND_LOW_PCT      = 20;    // 저가 퍼센타일 → bottom
export const V2_POC_BUCKETS       = 40;    // 거래량 프로파일 버킷 수
export const V2_MIN_REJECT_SCORE  = 0.50;  // 거절 강도 최솟값 (상·하단 각각)
export const V2_TOUCH_THRESHOLD   = 0.15;  // 터치 판정폭 (박스높이 × 값)

/**
 * Pine 스크립트와 동일하게 percentile 인덱스를 반올림으로 선택.
 * Pine: round((pct/100) * (n-1)) 후 clamp.
 * @param {number[]} values
 * @param {number} p 0–100
 */
export function percentilePickRound(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idxRaw = (p / 100) * (sorted.length - 1);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(idxRaw)));
  return sorted[idx];
}

/**
 * @param {import("./box-range-pro-core.js").Bar} bar
 * @param {number} top
 * @param {number} bot
 * @param {number} pad
 */
export function barInBandV2(bar, top, bot, pad) {
  return bar.high <= top + pad && bar.low >= bot - pad;
}

/**
 * @param {import("./box-range-pro-core.js").Bar} bar
 * @param {number} mid
 * @param {number} top
 * @param {number} bot
 * @param {number} splitPct
 */
export function barNearMidV2(bar, mid, top, bot, splitPct) {
  const halfH = (top - bot) * 0.5;
  if (halfH <= 1e-10) return true;
  return Math.abs(bar.close - mid) <= (splitPct / 100) * halfH;
}

// ── ER (Efficiency Ratio) ─────────────────────────────────────────────────
/**
 * Kaufman 효율비: 순 이동 / 총 경로
 * 0 → 완전 횡보(chop), 1 → 완전 직선 추세
 */
export function computeER(candles, oldestIdx, newestIdx) {
  if (newestIdx <= oldestIdx) return 1;
  const netMove = Math.abs(candles[newestIdx].close - candles[oldestIdx].close);
  let path = 0;
  for (let i = oldestIdx + 1; i <= newestIdx; i++) {
    path += Math.abs(candles[i].close - candles[i - 1].close);
  }
  return path > 0 ? netMove / path : 1;
}

// ── 거래량 프로파일 POC ───────────────────────────────────────────────────
/**
 * 구간 내 가장 많이 거래된 가격대 (Point of Control)
 */
export function computePOC(candles, oldestIdx, newestIdx, buckets = V2_POC_BUCKETS) {
  let minP = Infinity, maxP = -Infinity;
  for (let i = oldestIdx; i <= newestIdx; i++) {
    if (candles[i].low  < minP) minP = candles[i].low;
    if (candles[i].high > maxP) maxP = candles[i].high;
  }
  if (maxP <= minP + 1e-10) return (maxP + minP) / 2;

  const step = (maxP - minP) / buckets;
  const vol = new Array(buckets).fill(0);

  for (let i = oldestIdx; i <= newestIdx; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    const v = (Number.isFinite(c.volume) && c.volume > 0) ? c.volume : 1;
    const bucket = Math.min(Math.floor((tp - minP) / step), buckets - 1);
    vol[bucket] += v;
  }

  const maxBucket = vol.indexOf(Math.max(...vol));
  return minP + (maxBucket + 0.5) * step;
}

// ── V2 박스 경계 계산 ─────────────────────────────────────────────────────
/**
 * top  = 고가 80퍼센타일 (실제 저항 윅 포함)
 * bottom = 저가 20퍼센타일 (실제 지지 윅 포함)
 * mid  = 거래량 POC
 */
export function computeBoxV2Prices(candles, oldestIdx, newestIdx) {
  const highs = [], lows = [];
  for (let i = oldestIdx; i <= newestIdx; i++) {
    highs.push(candles[i].high);
    lows.push(candles[i].low);
  }

  // Pine(v2)와 동일: round 인덱스 선택
  const top    = percentilePickRound(highs, V2_BAND_HIGH_PCT);
  const bottom = percentilePickRound(lows,  V2_BAND_LOW_PCT);

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) {
    return { top: NaN, bottom: NaN, mid: NaN };
  }

  const poc = computePOC(candles, oldestIdx, newestIdx);
  const mid = Math.max(bottom, Math.min(top, poc));

  return { top, bottom, mid };
}

/**
 * V2 확장: 확장 판단용 박스 경계도 V2(고저 퍼센타일+POC)로 재계산.
 * Pine `expand_range_idx` 와 동일 구조.
 * @param {import("./box-range-pro-core.js").Bar[]} candles
 * @param {number} seedOldestIdx
 * @param {number} seedNewestIdx
 * @param {number} maxBars
 * @param {number} pad
 * @param {number} gapAllow
 * @param {number} splitPct
 * @returns {[number, number]} [newestIdx, oldestIdx]
 */
export function expandRangeIdxV2(
  candles,
  seedOldestIdx,
  seedNewestIdx,
  maxBars,
  pad,
  gapAllow,
  splitPct,
) {
  let newestIdx = seedNewestIdx;
  let oldestIdx = seedOldestIdx;
  let miss = 0;
  const lim = Math.min(maxBars, candles.length - 1);

  if (seedOldestIdx < lim) {
    for (let i = seedOldestIdx + 1; i <= lim; i++) {
      const { top, bottom, mid } = computeBoxV2Prices(candles, i, newestIdx);
      if (
        Number.isFinite(top) &&
        barInBandV2(candles[i], top, bottom, pad) &&
        barNearMidV2(candles[i], mid, top, bottom, splitPct)
      ) {
        oldestIdx = i;
        miss = 0;
      } else {
        miss += 1;
        if (miss >= gapAllow) break;
      }
    }
  }

  miss = 0;
  if (seedNewestIdx > 0) {
    for (let i = seedNewestIdx - 1; i >= 0; i--) {
      const { top, bottom, mid } = computeBoxV2Prices(candles, oldestIdx, i);
      if (
        Number.isFinite(top) &&
        barInBandV2(candles[i], top, bottom, pad) &&
        barNearMidV2(candles[i], mid, top, bottom, splitPct)
      ) {
        newestIdx = i;
        miss = 0;
      } else {
        miss += 1;
        if (miss >= gapAllow) break;
      }
    }
  }

  return [newestIdx, oldestIdx];
}

// ── 거절 강도 스코어 (거래량 가중) ────────────────────────────────────────
/**
 * 각 거절 터치를 "되돌림 강도 × sqrt(거래량 비율)"로 점수화
 * 단순 횟수 카운트보다 강한 거절·거래량이 많은 터치를 우대
 */
export function scoreRejectionsV2(candles, oldestIdx, newestIdx, top, bottom) {
  const h = top - bottom;
  if (h <= 0) return { topScore: 0, bottomScore: 0, topCount: 0, bottomCount: 0 };

  const th  = h * V2_TOUCH_THRESHOLD;
  const mid = (top + bottom) * 0.5;

  let volSum = 0, volCount = 0;
  for (let i = oldestIdx; i <= newestIdx; i++) {
    const v = candles[i].volume;
    if (Number.isFinite(v) && v > 0) { volSum += v; volCount++; }
  }
  const avgVol = volCount > 0 ? volSum / volCount : 1;

  let topScore = 0, bottomScore = 0, topCount = 0, bottomCount = 0;

  for (let i = oldestIdx; i <= newestIdx; i++) {
    const c = candles[i];
    const v       = (Number.isFinite(c.volume) && c.volume > 0) ? c.volume : avgVol;
    const volFact = Math.sqrt(v / avgVol);

    if (c.high >= top - th && c.close < mid) {
      // 상단 터치 후 중심 아래 종가 → 되돌림 강도
      const strength = Math.min(1, (top - c.close) / (h * 0.5));
      topScore += strength * volFact;
      topCount++;
    }
    if (c.low <= bottom + th && c.close > mid) {
      // 하단 터치 후 중심 위 종가 → 되돌림 강도
      const strength = Math.min(1, (c.close - bottom) / (h * 0.5));
      bottomScore += strength * volFact;
      bottomCount++;
    }
  }

  return { topScore, bottomScore, topCount, bottomCount };
}

// ── 메인 탐지 함수 ────────────────────────────────────────────────────────
/**
 * @param {import("./box-range-pro-core.js").Bar[]} candles
 * @param {number} endIdx
 * @param {"1h"|"4h"|"1d"} timeframe
 * @returns {{ box: object; startIdx: number } | null}
 */
export function detectBoxV2At(candles, endIdx, timeframe) {
  const end = endIdx;
  if (end < 1 || end >= candles.length) return null;

  const maxPct  = BOX_RANGE_MAX_PCT[timeframe] ?? 15;
  const minPct  = BOX_RANGE_MIN_PCT[timeframe] ?? 0;
  const splitPct = BOX_RANGE_PRO_SPLIT_MID_PCT[timeframe] ?? 48;
  const lookback = Math.min(BOX_RANGE_MAX_EXPAND_BARS, end);

  // ① 시드 수집 — 고저 범위가 maxPct 이내인 연속 봉
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
    const rangePct = minVal > 0 ? ((maxVal - minVal) / minVal) * 100 : 100;
    if (rangePct > maxPct) break;
    validCount++;
    startIdx = idx;
  }

  if (validCount < BOX_RANGE_MIN_BARS) return null;

  // ② ER 필터 — 시드 구간 효율비 > 임계값이면 추세로 판단 → 탈락
  const er = computeER(candles, startIdx, end);
  if (er > V2_ER_THRESHOLD) return null;

  // ③ 양방향 확장 (기존 expandRangeIdxPro 재사용 — 경계 인덱스 탐색)
  const seedH = maxVal - minVal;
  const pad = seedH * (BOX_RANGE_EXPAND_EDGE_PCT / 100);
  const [newestIdx, oldestIdx] = expandRangeIdxV2(
    candles,
    startIdx,
    end,
    lookback,
    pad,
    BOX_RANGE_EXPAND_GAP_BARS,
    splitPct,
  );

  // ④ V2 경계 계산 (고저 퍼센타일 + POC)
  const { top: boxTop, bottom: boxBot, mid } = computeBoxV2Prices(candles, oldestIdx, newestIdx);

  if (
    !Number.isFinite(boxTop) || !Number.isFinite(boxBot) ||
    !Number.isFinite(mid)    || boxTop <= boxBot
  ) return null;

  // ⑤ 크기 필터
  const hPct = boxHeightPct(boxTop, boxBot);
  if (minPct > 0 && hPct < minPct)     return null;
  if (hPct > maxPct * 1.5)             return null;  // wick 확대로 초과 방지

  // ⑥ 거절 강도 필터 (거래량 가중 점수)
  const { topScore, bottomScore, topCount, bottomCount } = scoreRejectionsV2(
    candles, oldestIdx, newestIdx, boxTop, boxBot,
  );

  if (topCount < 1 || bottomCount < 1) return null;
  if (topScore < V2_MIN_REJECT_SCORE || bottomScore < V2_MIN_REJECT_SCORE) return null;

  const leftTime  = normalizeBoxUnixTime(candles[oldestIdx].time);
  const rightTime = normalizeBoxUnixTime(candles[newestIdx].time);
  if (leftTime == null || rightTime == null) return null;

  return {
    box: {
      top: boxTop, bottom: boxBot, mid,
      leftTime, rightTime,
      validBars: newestIdx - oldestIdx + 1,
      er,
    },
    startIdx: oldestIdx,
  };
}

/**
 * @param {import("./box-range-pro-core.js").Bar[]} candles
 * @param {"1h"|"4h"|"1d"} timeframe
 * @param {number} [maxCount]
 * @returns {import("./box-range-pro-core.js").DetectedBox[]}
 */
export function detectBoxRangesV2OnCandles(candles, timeframe, maxCount = 5) {
  if (!Array.isArray(candles) || candles.length < BOX_RANGE_MIN_BARS + 2) {
    return [];
  }
  /** @type {import("./box-range-pro-core.js").DetectedBox[]} */
  const results = [];
  let searchEnd = candles.length - 2;

  while (results.length < maxCount && searchEnd >= BOX_RANGE_MIN_BARS + 1) {
    const result = detectBoxV2At(candles, searchEnd, timeframe);
    if (result) {
      results.push(result.box);
      searchEnd = result.startIdx - 1;
    } else {
      searchEnd -= Math.ceil(BOX_RANGE_MAX_EXPAND_BARS / 3);
    }
  }
  return results;
}
