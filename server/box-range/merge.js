import {
  BOX_RANGE_MERGE_BARS_GAP,
  BOX_RANGE_MERGE_PCT,
  BOX_RANGE_SIMILAR_RANGE_PCT,
} from "./constants.js";

/**
 * @param {number} t1
 * @param {number} b1
 * @param {number} t2
 * @param {number} b2
 */
export function priceOverlapPct(t1, b1, t2, b2) {
  const hi = Math.min(t1, t2);
  const lo = Math.max(b1, b2);
  const overlap = Math.max(0, hi - lo);
  const h1 = t1 - b1;
  const h2 = t2 - b2;
  const base = Math.max(h1, h2, 1e-12);
  return (overlap / base) * 100;
}

/**
 * @param {number} l1
 * @param {number} r1
 * @param {number} l2
 * @param {number} r2
 * @param {number} gap — 봉 time(초) 단위 간격 허용
 */
export function timesNearOverlap(l1, r1, l2, r2, gap) {
  return l1 <= r2 + gap && l2 <= r1 + gap;
}

/**
 * @param {number} tA
 * @param {number} bA
 * @param {number} tB
 * @param {number} bB
 * @param {number} tolPct
 */
export function similarRange(tA, bA, tB, bB, tolPct) {
  const tol =
    (Math.max(tA - bA, tB - bB) * tolPct) / 100;
  return Math.abs(tA - tB) <= tol && Math.abs(bA - bB) <= tol;
}

/**
 * @param {{
 *   top: number;
 *   bottom: number;
 *   leftTime: number;
 *   rightTime: number;
 *   timeframe: string;
 * }} candidate
 * @param {typeof candidate[]} existing — 동일 program·symbol·tf
 * @param {number} barSec — 봉 간격(초)
 */
export function findMergeBoxIndex(candidate, existing, barSec) {
  const gap = BOX_RANGE_MERGE_BARS_GAP * barSec;
  for (let j = 0; j < existing.length; j++) {
    const e = existing[j];
    if (e.timeframe !== candidate.timeframe) continue;
    if (e.state === "closed") continue;
    const priceOk =
      priceOverlapPct(
        candidate.top,
        candidate.bottom,
        e.top,
        e.bottom,
      ) >= BOX_RANGE_MERGE_PCT ||
      similarRange(
        candidate.top,
        candidate.bottom,
        e.top,
        e.bottom,
        BOX_RANGE_SIMILAR_RANGE_PCT,
      );
    const timeOk = timesNearOverlap(
      candidate.leftTime,
      candidate.rightTime,
      e.leftTime,
      e.rightTime,
      gap,
    );
    if (priceOk && timeOk) return j;
  }
  return -1;
}
