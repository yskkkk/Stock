/** @typedef {{ id: string, label: string }} SignalHit */

export const SIGNAL_DEFS = [
  { id: "ma_align", label: "이동평균 정배열" },
  { id: "ma_golden", label: "이평선 골든크로스" },
  { id: "ma20", label: "20봉 위" },
  { id: "ma50", label: "50일선 위" },
  { id: "ma5_align", label: "5·20 단기 정배열" },
  { id: "rsi", label: "RSI 상승" },
  { id: "volume", label: "거래량 증가" },
  { id: "volume_surge", label: "거래량 급증" },
  { id: "macd", label: "MACD 상승" },
  { id: "high_60", label: "60일 고가 근접" },
  { id: "bull_bar", label: "양봉" },
];

/** 점수 항목 최대치 (가중 합산, UI·참고용) */
export const MAX_TECH_SCORE = 13;

/** 스크리너 추천: SIGNAL_DEFS 전체 조건 중 이 비율 이상 충족 시 통과 */
export const MIN_CONDITION_SATISFY_RATIO = 0.8;
/** 텔레그램 알림: 가중 점수(MAX_TECH_SCORE) 대비 이 비율 초과 시 발송 */
export const MIN_TELEGRAM_SCORE_RATIO = 0.8;
export const SIGNAL_CONDITION_TOTAL = SIGNAL_DEFS.length;

export function minConditionsRequired(
  total = SIGNAL_CONDITION_TOTAL,
  ratio = MIN_CONDITION_SATISFY_RATIO,
) {
  return Math.ceil(total * ratio);
}

export function meetsBuyCondition(
  metCount,
  total = SIGNAL_CONDITION_TOTAL,
  ratio = MIN_CONDITION_SATISFY_RATIO,
) {
  return metCount >= minConditionsRequired(total, ratio);
}

/** @param {number} score 가중 합산 점수 */
export function meetsTelegramNotifyScore(
  score,
  max = MAX_TECH_SCORE,
  ratio = MIN_TELEGRAM_SCORE_RATIO,
) {
  if (!Number.isFinite(score)) return false;
  return score > max * ratio;
}

export function minTelegramScoreRequired(
  max = MAX_TECH_SCORE,
  ratio = MIN_TELEGRAM_SCORE_RATIO,
) {
  const threshold = max * ratio;
  return Math.floor(threshold) + (Number.isInteger(threshold) ? 0 : 1);
}

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let j = 0; j < period; j++) sum += values[j];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
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

function macdBullish(closes, i) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  if (
    ema12[i] == null ||
    ema26[i] == null ||
    ema12[i - 1] == null ||
    ema26[i - 1] == null
  ) {
    return false;
  }
  const m = ema12[i] - ema26[i];
  const mPrev = ema12[i - 1] - ema26[i - 1];
  return m > 0 && m > mPrev;
}

export function analyzeTechnicals(candles) {
  if (candles.length < 55) {
    return { score: 0, signalIds: [], signals: [], buy: false };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const volumes = candles.map((c) => c.volume);
  const i = closes.length - 1;
  const last = candles[i];

  const sma5 = sma(closes, 5);
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
    hits.push({ id: "ma20", label: "20봉 위" });
  }

  if (sma50[i] != null && closes[i] > sma50[i]) {
    score += 1;
    hits.push({ id: "ma50", label: "50일선 위" });
  }

  if (sma5[i] != null && sma20[i] != null && sma5[i] > sma20[i]) {
    score += 1;
    hits.push({ id: "ma5_align", label: "5·20 단기 정배열" });
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
    if (volumes[i] > avgVol * 1.5) {
      score += 1;
      hits.push({ id: "volume_surge", label: "거래량 급증" });
    }
  }

  if (macdBullish(closes, i)) {
    score += 1;
    hits.push({ id: "macd", label: "MACD 상승" });
  }

  const highSlice = highs.slice(Math.max(0, i - 59), i + 1);
  if (highSlice.length > 0) {
    const max60 = Math.max(...highSlice);
    if (max60 > 0 && closes[i] >= max60 * 0.97) {
      score += 1;
      hits.push({ id: "high_60", label: "60일 고가 근접" });
    }
  }

  if (last.close > last.open) {
    hits.push({ id: "bull_bar", label: "양봉" });
  }

  const conditionsMet = hits.length;
  return {
    score,
    signalIds: hits.map((h) => h.id),
    signals: hits.map((h) => h.label),
    conditionsMet,
    conditionsTotal: SIGNAL_CONDITION_TOTAL,
    buy: meetsBuyCondition(conditionsMet),
  };
}
