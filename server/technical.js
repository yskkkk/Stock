/** @typedef {{ id: string, label: string }} SignalHit */

export const SIGNAL_DEFS = [
  { id: "ma_align", label: "이동평균 정배열" },
  { id: "ma_golden", label: "이평선 골든크로스" },
  { id: "ma20", label: "20일선 위" },
  { id: "rsi", label: "RSI 상승" },
  { id: "volume", label: "거래량 증가" },
];

/** 점수 항목 최대치 (일목·신고가 제외) */
export const MAX_TECH_SCORE = 8;

const MIN_SCORE = 5;

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    out[i] = sum / period;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let k = 1; k <= period; k++) {
    const diff = values[k] - values[k - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let k = period + 1; k < values.length; k++) {
    const diff = values[k] - values[k - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[k] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** 최근 lookback 봉 이내 fast가 slow를 상향 돌파 */
function recentCrossAbove(fast, slow, i, lookback = 5) {
  if (fast[i] == null || slow[i] == null || fast[i] <= slow[i]) return false;
  for (let j = Math.max(0, i - lookback); j < i; j++) {
    if (fast[j] != null && slow[j] != null && fast[j] <= slow[j]) return true;
  }
  return false;
}

export function analyzeTechnicals(candles) {
  if (candles.length < 55) {
    return { score: 0, signalIds: [], signals: [], buy: false };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const i = closes.length - 1;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);

  /** @type {SignalHit[]} */
  const hits = [];
  let score = 0;

  if (sma20[i] != null && sma50[i] != null && sma20[i] > sma50[i]) {
    score += 2;
    hits.push({ id: "ma_align", label: "이동평균 정배열" });
  }

  if (recentCrossAbove(sma20, sma50, i, 5)) {
    score += 2;
    hits.push({ id: "ma_golden", label: "이평선 골든크로스" });
  }

  if (sma20[i] != null && closes[i] > sma20[i]) {
    score += 1;
    hits.push({ id: "ma20", label: "20일선 위" });
  }

  const rsiNow = rsi14[i];
  const rsiPrev = rsi14[i - 1];
  if (
    rsiNow != null &&
    rsiPrev != null &&
    rsiNow >= 42 &&
    rsiNow <= 68 &&
    rsiNow > rsiPrev
  ) {
    score += 2;
    hits.push({ id: "rsi", label: "RSI 상승" });
  }

  const volSlice = volumes.slice(-21, -1).filter((v) => v > 0);
  if (volSlice.length > 0) {
    const avgVol = volSlice.reduce((a, b) => a + b, 0) / volSlice.length;
    if (volumes[i] > avgVol * 1.15) {
      score += 1;
      hits.push({ id: "volume", label: "거래량 증가" });
    }
  }

  return {
    score,
    signalIds: hits.map((h) => h.id),
    signals: hits.map((h) => h.label),
    buy: score >= MIN_SCORE,
  };
}
