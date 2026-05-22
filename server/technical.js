/** @typedef {{ id: string, label: string }} SignalHit */

import {
  getPrimaryActiveWeightsSync,
  getTechModelByIdSync,
  sumTechScoreWeights,
} from "./picks-tech-models-store.js";
import {
  DEFAULT_MAX_TECH_SCORE,
  SIGNAL_SCORE_WEIGHT,
} from "./technical-default-weights.js";

export { SIGNAL_SCORE_WEIGHT } from "./technical-default-weights.js";

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
  { id: "vp_breakout", label: "매물대 돌파" },
  { id: "bull_bar", label: "양봉" },
];

/** 기본 최대 가중 점수(오버라이드 없을 때) */
export const MAX_TECH_SCORE = DEFAULT_MAX_TECH_SCORE;

/** @param {Record<string, number>} [weights] */
export function getMaxTechScore(weights) {
  const w = weights ?? getPrimaryActiveWeightsSync();
  return sumTechScoreWeights(w);
}

/** @param {string} id @param {Record<string, number>} [weights] */
export function getSignalScoreWeight(id, weights) {
  const map = weights ?? getPrimaryActiveWeightsSync();
  const v = map[String(id ?? "").trim()];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * @param {string[]} signalIds
 * @param {Record<string, number>} [weights]
 */
export function weightedScoreFromSignalIds(signalIds, weights) {
  if (!Array.isArray(signalIds)) return 0;
  let n = 0;
  for (const id of signalIds) {
    n += getSignalScoreWeight(id, weights);
  }
  return n;
}

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

/** @param {number} score @param {Record<string, number>} [weights] */
export function meetsTelegramNotifyScore(
  score,
  weights,
  ratio = MIN_TELEGRAM_SCORE_RATIO,
) {
  if (!Number.isFinite(score)) return false;
  const max = getMaxTechScore(weights);
  return score > max * ratio;
}

export function minTelegramScoreRequired(
  weights,
  ratio = MIN_TELEGRAM_SCORE_RATIO,
) {
  const max = getMaxTechScore(weights);
  const threshold = max * ratio;
  return Math.floor(threshold) + (Number.isInteger(threshold) ? 0 : 1);
}

/** @param {Record<string, number> | null | undefined} weights */
function resolveWeightsForPick(weights, techModelId) {
  if (weights && typeof weights === "object" && Object.keys(weights).length > 0) {
    return weights;
  }
  const id = String(techModelId ?? "").trim();
  if (id) {
    const model = getTechModelByIdSync(id);
    if (model?.weights) return model.weights;
  }
  return getPrimaryActiveWeightsSync();
}

/** @param {number} score @param {number} maxScore */
export function formatWeightedScorePercentLabel(score, maxScore) {
  if (!Number.isFinite(maxScore) || maxScore <= 0) return "—";
  if (!Number.isFinite(score)) return "0.0";
  const pct = Math.min(100, (score / maxScore) * 100);
  return (Math.round(pct * 10) / 10).toFixed(1);
}

/**
 * 텔레그램·알림용 — 모델 만점 대비 실제 가중 점수·% (signalIds 기준 재계산).
 * @param {{
 *   score?: number;
 *   signalIds?: string[];
 *   techModelWeights?: Record<string, number>;
 *   techModelId?: string;
 *   techModelMaxScore?: number;
 * }} pick
 */
export function resolvePickWeightedScoreBreakdown(pick) {
  const weights = resolveWeightsForPick(
    pick?.techModelWeights,
    pick?.techModelId,
  );
  const maxScore =
    typeof pick?.techModelMaxScore === "number" &&
    Number.isFinite(pick.techModelMaxScore) &&
    pick.techModelMaxScore > 0
      ? pick.techModelMaxScore
      : getMaxTechScore(weights);
  let score =
    typeof pick?.score === "number" && Number.isFinite(pick.score)
      ? pick.score
      : 0;
  const signalIds = Array.isArray(pick?.signalIds) ? pick.signalIds : [];
  if (signalIds.length > 0) {
    const fromSignals = weightedScoreFromSignalIds(signalIds, weights);
    if (Number.isFinite(fromSignals)) score = fromSignals;
  }
  const pctLabel = formatWeightedScorePercentLabel(score, maxScore);
  const pctRaw =
    maxScore > 0 ? Math.min(100, (score / maxScore) * 100) : 0;
  return { score, maxScore, weights, pctLabel, pctRaw };
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

/** 최근 구간 거래량 집중 가격대(매물대) 상단 돌파 */
function volumeProfileBreakout(candles, i, lookback = 40) {
  const start = Math.max(0, i - lookback + 1);
  const slice = candles.slice(start, i + 1);
  if (slice.length < 20) return false;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of slice) {
    minP = Math.min(minP, c.low);
    maxP = Math.max(maxP, c.high);
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) return false;

  const BINS = 10;
  /** @type {number[]} */
  const volByBin = new Array(BINS).fill(0);
  for (const c of slice) {
    const mid = (c.high + c.low) / 2;
    const b = Math.min(
      BINS - 1,
      Math.floor(((mid - minP) / (maxP - minP)) * BINS),
    );
    volByBin[b] += c.volume > 0 ? c.volume : 0;
  }
  let pocBin = 0;
  for (let b = 1; b < BINS; b++) {
    if (volByBin[b] > volByBin[pocBin]) pocBin = b;
  }
  const binSize = (maxP - minP) / BINS;
  const pocTop = minP + (pocBin + 1) * binSize;
  const last = slice[slice.length - 1];
  const prev = slice.length >= 2 ? slice[slice.length - 2] : last;
  if (prev.close > pocTop || last.close <= pocTop) return false;

  const volumes = candles.map((c) => c.volume);
  const volHist = volumes.slice(Math.max(0, i - 21), i).filter((v) => v > 0);
  if (!volHist.length) return true;
  const avgVol = volHist.reduce((a, b) => a + b, 0) / volHist.length;
  return (volumes[i] ?? 0) >= avgVol * 1.05;
}

/**
 * @param {SignalHit[]} hits
 * @param {number} score
 * @param {string} id
 * @param {string} label
 */
function addSignalHit(hits, score, id, label, weights) {
  const w = getSignalScoreWeight(id, weights);
  hits.push({ id, label });
  return score + (w > 0 ? w : 0);
}

/** @param {unknown[]} candles @param {Record<string, number>} [weights] */
export function analyzeTechnicals(candles, weights) {
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
    score = addSignalHit(hits, score, "ma_align", "이동평균 정배열", weights);
  }

  if (recentCrossAbove(sma20, sma50, i, 5)) {
    score = addSignalHit(hits, score, "ma_golden", "이평선 골든크로스", weights);
  }

  if (sma20[i] != null && closes[i] > sma20[i]) {
    score = addSignalHit(hits, score, "ma20", "20봉 위", weights);
  }

  if (sma50[i] != null && closes[i] > sma50[i]) {
    score = addSignalHit(hits, score, "ma50", "50일선 위", weights);
  }

  if (sma5[i] != null && sma20[i] != null && sma5[i] > sma20[i]) {
    score = addSignalHit(hits, score, "ma5_align", "5·20 단기 정배열", weights);
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
    score = addSignalHit(hits, score, "rsi", "RSI 상승", weights);
  }

  const volSlice = volumes.slice(-21, -1).filter((v) => v > 0);
  if (volSlice.length > 0) {
    const avgVol = volSlice.reduce((a, b) => a + b, 0) / volSlice.length;
    if (volumes[i] > avgVol * 1.15) {
      score = addSignalHit(hits, score, "volume", "거래량 증가", weights);
    }
    if (volumes[i] > avgVol * 1.5) {
      score = addSignalHit(hits, score, "volume_surge", "거래량 급증", weights);
    }
  }

  if (macdBullish(closes, i)) {
    score = addSignalHit(hits, score, "macd", "MACD 상승", weights);
  }

  const highSlice = highs.slice(Math.max(0, i - 59), i + 1);
  if (highSlice.length > 0) {
    const max60 = Math.max(...highSlice);
    if (max60 > 0 && closes[i] >= max60 * 0.97) {
      score = addSignalHit(hits, score, "high_60", "60일 고가 근접", weights);
    }
  }

  if (volumeProfileBreakout(candles, i)) {
    score = addSignalHit(hits, score, "vp_breakout", "매물대 돌파", weights);
  }

  if (last.close > last.open) {
    score = addSignalHit(hits, score, "bull_bar", "양봉", weights);
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
