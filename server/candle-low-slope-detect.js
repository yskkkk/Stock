/**
 * 일봉 캔들 저점(pivot low)을 잇는 선분의 기울기 부호가 바뀌는지 탐지.
 */

/**
 * @param {Array<{ low?: number; date?: string; time?: string }>} candles
 * @param {number} left
 * @param {number} right
 */
export function findPivotLows(candles, left = 3, right = 3) {
  if (!Array.isArray(candles) || candles.length < left + right + 1) return [];
  /** @type {Array<{ index: number; low: number; date: string }>} */
  const pivots = [];
  for (let i = left; i < candles.length - right; i++) {
    const low = Number(candles[i]?.low);
    if (!Number.isFinite(low)) continue;
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      const other = Number(candles[j]?.low);
      if (Number.isFinite(other) && other < low) {
        isPivot = false;
        break;
      }
    }
    if (!isPivot) continue;
    const rawDate = candles[i]?.date ?? candles[i]?.time ?? "";
    const date = String(rawDate).trim().slice(0, 10) || String(i);
    pivots.push({ index: i, low, date });
  }
  return pivots;
}

/** @param {number} a @param {number} b */
function slopeSign(a, b) {
  const d = b - a;
  if (d > 0) return 1;
  if (d < 0) return -1;
  return 0;
}

/**
 * @param {Array<{ index: number; low: number; date: string }>} pivots
 * @param {number} minGapBars
 */
export function mergeNearbyPivotLows(pivots, minGapBars = 3) {
  /** @type {typeof pivots} */
  const out = [];
  for (const p of pivots) {
    const last = out[out.length - 1];
    if (last && p.index - last.index < minGapBars) {
      if (p.low < last.low) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * @param {Array<{ low?: number; date?: string; time?: string }>} candles
 * @param {{
 *   pivotLeft?: number;
 *   pivotRight?: number;
 *   recentBars?: number;
 *   minPivotGap?: number;
 * }} [opts]
 */
export function detectCandleLowSlopeFlipLatest(candles, opts = {}) {
  const pivotLeft = opts.pivotLeft ?? 3;
  const pivotRight = opts.pivotRight ?? 3;
  const recentBars = opts.recentBars ?? 8;
  const minPivotGap = opts.minPivotGap ?? 4;
  const minLen = pivotLeft + pivotRight + minPivotGap * 2 + 4;
  if (!Array.isArray(candles) || candles.length < minLen) {
    return { hit: false };
  }

  const pivots = mergeNearbyPivotLows(
    findPivotLows(candles, pivotLeft, pivotRight),
    minPivotGap,
  );
  if (pivots.length < 3) return { hit: false };

  const lastIdx = candles.length - 1;
  for (let k = pivots.length - 1; k >= 2; k--) {
    const p2 = pivots[k];
    const p1 = pivots[k - 1];
    const p0 = pivots[k - 2];
    if (lastIdx - p2.index > recentBars) continue;

    const signPrev = slopeSign(p0.low, p1.low);
    const signCurr = slopeSign(p1.low, p2.low);
    if (signPrev === 0 || signCurr === 0 || signPrev === signCurr) continue;

    return {
      hit: true,
      signalDate: p2.date,
      pivotLow: p2.low,
      lowSlopeFlip: signPrev < 0 && signCurr > 0 ? "down_to_up" : "up_to_down",
      prevPivotLow: p1.low,
      prevPrevPivotLow: p0.low,
    };
  }
  return { hit: false };
}
