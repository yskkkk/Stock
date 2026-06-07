/**
 * 일봉 candles[i] ↔ 유효 close만 모은 closes[j] 인덱스 매핑
 * @param {Array<{ close?: number }>} candles
 */
export function buildDailyClosesIndex(candles) {
  const closes = [];
  const candleToCloseIndex = new Array(candles.length).fill(-1);
  for (let ci = 0; ci < candles.length; ci++) {
    const v = Number(candles[ci]?.close);
    if (!Number.isFinite(v)) continue;
    candleToCloseIndex[ci] = closes.length;
    closes.push(v);
  }
  return { closes, candleToCloseIndex };
}

/**
 * @param {number[]} candleToCloseIndex
 * @param {number} candleIndex
 */
export function resolveCloseIndexAtCandle(candleToCloseIndex, candleIndex) {
  if (candleIndex < 0 || candleIndex >= candleToCloseIndex.length) return -1;
  if (candleToCloseIndex[candleIndex] >= 0) {
    return candleToCloseIndex[candleIndex];
  }
  for (let ci = candleIndex; ci >= 0; ci--) {
    if (candleToCloseIndex[ci] >= 0) return candleToCloseIndex[ci];
  }
  return -1;
}

/**
 * @param {number[]} candleToCloseIndex
 * @param {number | null | undefined} barIndex — candles 기준; null이면 마지막 봉
 * @param {number} candlesLength
 */
export function resolveCandleBarIndex(candleToCloseIndex, barIndex, candlesLength) {
  const rawCi =
    barIndex == null
      ? candlesLength - 1
      : Math.min(Math.max(0, barIndex), candlesLength - 1);
  return {
    candleIndex: rawCi,
    closeIndex: resolveCloseIndexAtCandle(candleToCloseIndex, rawCi),
  };
}
