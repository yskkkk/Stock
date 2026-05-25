/**
 * 실거래 매도 전략 — 단기·중기·장기(가치) + 사유 기반 청산
 */
import { loadStock } from "./stock-data.js";
import { DEFAULT_ROUND_TRIP_FEE_RATE, netReturnPct } from "./net-return.js";

/** @typedef {"short" | "medium" | "long"} LiveTradeSellHorizon */

export const SELL_HORIZON_LABELS = {
  short: "단기",
  medium: "중기",
  long: "장기",
};

/** 5분봉 RSI·MACD 등 기술 청산 최소 순수익(%, 왕복 수수료 반영) */
export const SHORT_MIN_TECH_EXIT_NET_PCT = 1.0;

/** 순수익 구간별 고점 대비 트레일링 허용 하락(%) — 높은 순수익일수록 여유 */
export const SHORT_TRAILING_STEPS = [
  { minNetPct: 10, dropFromHighPct: 3 },
  { minNetPct: 6, dropFromHighPct: 2 },
  { minNetPct: 3, dropFromHighPct: 1.2 },
];

/**
 * @param {unknown} v
 * @returns {LiveTradeSellHorizon}
 */
export function normalizeSellHorizon(v) {
  const s = String(v ?? "short").toLowerCase().trim();
  if (s === "medium" || s === "long") return s;
  return "short";
}

/**
 * @param {{ sellHorizon?: string; status?: string }} [program]
 */
export function resolveProgramSellHorizon(program) {
  if (program?.sellHorizon) return normalizeSellHorizon(program.sellHorizon);
  if (program?.status === "armed") return "short";
  return "short";
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

function macdLine(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  return closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null,
  );
}

/**
 * @param {unknown[]} candles
 * @param {number} lookback
 */
/**
 * @param {unknown[]} candles
 * @param {number} period
 */
function atr14FromCandles(candles, period = 14) {
  if (!candles?.length || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const h = Number(c?.high ?? c?.close);
    const l = Number(c?.low ?? c?.close);
    const pc = Number(prev?.close);
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) continue;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return null;
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * @param {number} netPct
 * @returns {{ minNetPct: number; dropFromHighPct: number } | null}
 */
export function resolveShortTrailingStep(netPct) {
  for (const step of SHORT_TRAILING_STEPS) {
    if (netPct >= step.minNetPct) return step;
  }
  return null;
}

/**
 * @param {{
 *   avgEntryPrice: number;
 *   stopLossPrice?: number | null;
 * }} pos
 * @param {unknown[]} candles
 * @param {{ roundTripFeeRate?: number }} ctx
 */
export function computeShortTermTechnicalStopLoss(pos, candles, ctx = {}) {
  if (pos.stopLossPrice != null && Number.isFinite(pos.stopLossPrice)) {
    return pos.stopLossPrice;
  }
  const entry = Number(pos.avgEntryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;

  const fee = ctx.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE;
  const swing = recentSwingLow(candles, 12);
  const atr = atr14FromCandles(candles, 14);

  /** @type {number[]} */
  const candidates = [];
  if (swing != null && swing < entry) candidates.push(swing * 0.996);
  if (atr != null && atr > 0) {
    const atrStop = entry - atr * 1.35;
    if (atrStop > 0 && atrStop < entry) candidates.push(atrStop);
  }
  if (!candidates.length) {
    const fallbackNetPct = -2.5;
    const mult = (1 + fallbackNetPct / 100) / (1 - fee);
    const px = entry * mult;
    return px > 0 ? px : null;
  }
  return Math.max(...candidates);
}

function passesShortTechnicalExitNetGate(netPct) {
  return netPct >= SHORT_MIN_TECH_EXIT_NET_PCT;
}

function recentSwingLow(candles, lookback = 12) {
  if (!candles?.length) return null;
  const slice = candles.slice(-lookback - 1, -1);
  if (!slice.length) return null;
  let min = Infinity;
  for (const c of slice) {
    const l = Number(c.low ?? c.close);
    if (Number.isFinite(l) && l < min) min = l;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * @param {unknown[]} candles
 * @param {number} sinceMs
 */
function maxHighSince(candles, sinceMs) {
  if (!candles?.length || !sinceMs) return null;
  let max = -Infinity;
  for (const c of candles) {
    const t = Number(c.time);
    const ms = t > 1e12 ? t : t * 1000;
    if (ms < sinceMs) continue;
    const h = Number(c.high ?? c.close);
    if (Number.isFinite(h) && h > max) max = h;
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * @param {ReturnType<typeof buildStaticTargetHit>} hit
 * @param {LiveTradeSellHorizon} horizon
 * @param {string} signal
 */
function finalizeHit(hit, horizon, signal) {
  if (!hit) return null;
  const label = SELL_HORIZON_LABELS[horizon] ?? horizon;
  return {
    price: hit.price,
    note: `[${label}] ${hit.note}`,
    horizon,
    signal,
  };
}

/**
 * @param {{
 *   targetSellPrice?: number | null;
 *   stopLossPrice?: number | null;
 *   avgEntryPrice?: number;
 * }} pos
 * @param {number} currentPrice
 */
function buildStaticTargetHit(pos, currentPrice) {
  const target = pos.targetSellPrice;
  const stop = pos.stopLossPrice;
  if (target != null && currentPrice >= target) {
    return { price: target, note: "목표가 도달" };
  }
  if (stop != null && currentPrice <= stop) {
    return { price: stop, note: "손절가 도달" };
  }
  return null;
}

/**
 * @param {{
 *   avgEntryPrice: number;
 *   boughtAtMs?: number | null;
 *   buySignalIds?: string[];
 *   targetSellPrice?: number | null;
 *   stopLossPrice?: number | null;
 * }} pos
 * @param {number} currentPrice
 * @param {unknown[]} candles
 * @param {{ roundTripFeeRate?: number }} ctx
 */
function evaluateShortTermSell(pos, currentPrice, candles, ctx) {
  const technicalStop = computeShortTermTechnicalStopLoss(pos, candles, ctx);
  const posForExit = {
    ...pos,
    stopLossPrice: technicalStop ?? pos.stopLossPrice ?? null,
  };
  const staticHit = buildStaticTargetHit(posForExit, currentPrice);
  if (staticHit) {
    const signal = staticHit.note.includes("손절") ? "stop_loss" : "take_profit";
    if (signal === "stop_loss") {
      console.warn(
        "[live-trade-sell:short] 손절 발동",
        { price: currentPrice, stop: posForExit.stopLossPrice, note: staticHit.note },
      );
    }
    return finalizeHit(staticHit, "short", signal);
  }

  const entry = Number(pos.avgEntryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const fee = ctx.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE;
  const netPct = netReturnPct(entry, currentPrice, fee);
  const boughtAtMs = pos.boughtAtMs ?? Date.now();
  const holdMs = Date.now() - boughtAtMs;
  const holdHours = holdMs / 3_600_000;

  if (holdMs < 5 * 60_000) return null;

  if (!candles?.length || candles.length < 30) {
    if (holdHours >= 48 && netPct < 1) {
      return finalizeHit(
        { price: currentPrice, note: `보유 ${holdHours.toFixed(0)}h — 수익 ${netPct.toFixed(1)}% 정체` },
        "short",
        "time_stop",
      );
    }
    return null;
  }

  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const i = closes.length - 1;
  if (i < 20) return null;

  const sessionHighEarly = maxHighSince(candles, boughtAtMs);
  const trailStepEarly = resolveShortTrailingStep(netPct);
  if (sessionHighEarly != null && trailStepEarly) {
    const dropPctEarly = ((sessionHighEarly - currentPrice) / sessionHighEarly) * 100;
    if (dropPctEarly >= trailStepEarly.dropFromHighPct) {
      return finalizeHit(
        {
          price: currentPrice,
          note: `익절 트레일링 (순수익 ${netPct.toFixed(1)}%≥${trailStepEarly.minNetPct}% · 고점 대비 -${dropPctEarly.toFixed(1)}%≥${trailStepEarly.dropFromHighPct}%)`,
        },
        "short",
        "trailing_take",
      );
    }
  }

  const rsi14 = rsi(closes, 14);
  const r0 = rsi14[i];
  const r1 = rsi14[i - 1];
  const r2 = rsi14[i - 2];
  if (
    r0 != null &&
    r1 != null &&
    r2 != null &&
    r2 >= 68 &&
    r1 > r0 &&
    r1 >= 65 &&
    passesShortTechnicalExitNetGate(netPct)
  ) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `RSI 과매수 후 하락 (5분 RSI ${r2.toFixed(0)}→${r0.toFixed(0)}, 순수익 ${netPct.toFixed(1)}%)`,
      },
      "short",
      "rsi_exhaustion",
    );
  }

  const macd = macdLine(closes);
  const m0 = macd[i];
  const m1 = macd[i - 1];
  const m2 = macd[i - 2];
  if (
    m0 != null &&
    m1 != null &&
    m2 != null &&
    m1 > 0 &&
    m0 < m1 &&
    m1 > m2 &&
    passesShortTechnicalExitNetGate(netPct)
  ) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `MACD 하락 전환 (5분, 순수익 ${netPct.toFixed(1)}%)`,
      },
      "short",
      "macd_roll",
    );
  }

  const swingLow = recentSwingLow(candles, 12);
  if (
    swingLow != null &&
    currentPrice < swingLow * 0.998 &&
    (passesShortTechnicalExitNetGate(netPct) || netPct < 0)
  ) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `5분봉 단기 지지 이탈 (저점 ${Math.round(swingLow).toLocaleString("ko-KR")}, 순수익 ${netPct.toFixed(1)}%)`,
      },
      "short",
      "swing_low_break",
    );
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const vol = Number(last?.volume);
  const prevVol = Number(prev?.volume);
  const red2 =
    Number(last?.close) < Number(last?.open) &&
    Number(prev?.close) < Number(prev?.open);
  if (
    red2 &&
    passesShortTechnicalExitNetGate(netPct) &&
    Number.isFinite(vol) &&
    Number.isFinite(prevVol) &&
    vol > prevVol * 1.3
  ) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `거래량 동반 음봉 2연속 (수익 ${netPct.toFixed(1)}% 확보)`,
      },
      "short",
      "distribution",
    );
  }

  if (holdHours >= 36 && netPct < 0.8) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `단기 보유 한도 ${holdHours.toFixed(0)}h — 모멘텀 미달 (수익 ${netPct.toFixed(1)}%)`,
      },
      "short",
      "time_stop",
    );
  }

  return null;
}

/**
 * @param {Parameters<typeof evaluateShortTermSell>[0]} pos
 * @param {number} currentPrice
 * @param {unknown[]} candles
 * @param {{ roundTripFeeRate?: number }} ctx
 */
function evaluateMediumTermSell(pos, currentPrice, candles, ctx) {
  const staticHit = buildStaticTargetHit(pos, currentPrice);
  if (staticHit) {
    return finalizeHit(staticHit, "medium", staticHit.note.includes("손절") ? "stop_loss" : "take_profit");
  }

  const entry = Number(pos.avgEntryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const fee = ctx.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE;
  const netPct = netReturnPct(entry, currentPrice, fee);
  const holdHours = (Date.now() - (pos.boughtAtMs ?? Date.now())) / 3_600_000;
  if (holdHours < 6) return null;

  if (!candles?.length || candles.length < 40) {
    if (holdHours >= 14 * 24 && netPct < 2) {
      return finalizeHit(
        { price: currentPrice, note: `스윙 보유 14일 — 수익 ${netPct.toFixed(1)}% 미달` },
        "medium",
        "time_stop",
      );
    }
    return null;
  }

  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const i = closes.length - 1;
  const swingLow = recentSwingLow(candles, 20);
  if (swingLow != null && currentPrice < swingLow * 0.995) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `1시간봉 스윙 저점 이탈 (수익 ${netPct.toFixed(1)}%)`,
      },
      "medium",
      "swing_structure_break",
    );
  }

  const macd = macdLine(closes);
  const m0 = macd[i];
  const m1 = macd[i - 1];
  if (m0 != null && m1 != null && m1 > 0 && m0 < 0 && netPct > 0.5) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `1시간 MACD 약세 전환 (수익 ${netPct.toFixed(1)}%)`,
      },
      "medium",
      "macd_bear",
    );
  }

  const rsi14 = rsi(closes, 14);
  const r0 = rsi14[i];
  const rPrev = rsi14[i - 5];
  if (r0 != null && rPrev != null && rPrev >= 58 && r0 <= 42 && netPct > 0) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `RSI 추세 약화 (${rPrev.toFixed(0)}→${r0.toFixed(0)})`,
      },
      "medium",
      "rsi_trend_fade",
    );
  }

  if (holdHours >= 10 * 24 && netPct < 1.5) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `스윙 보유 10일 — 기대 수익 미달 (${netPct.toFixed(1)}%)`,
      },
      "medium",
      "time_stop",
    );
  }

  return null;
}

/**
 * @param {Parameters<typeof evaluateShortTermSell>[0]} pos
 * @param {number} currentPrice
 * @param {unknown[]} candles
 * @param {{ roundTripFeeRate?: number }} ctx
 */
function evaluateLongTermSell(pos, currentPrice, candles, ctx) {
  const stop = pos.stopLossPrice;
  if (stop != null && currentPrice <= stop) {
    return finalizeHit(
      { price: stop, note: "손절가 도달" },
      "long",
      "stop_loss",
    );
  }

  const entry = Number(pos.avgEntryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const fee = ctx.roundTripFeeRate ?? DEFAULT_ROUND_TRIP_FEE_RATE;
  const netPct = netReturnPct(entry, currentPrice, fee);
  const target = pos.targetSellPrice;
  if (target != null && currentPrice >= target) {
    return finalizeHit(
      { price: target, note: `가치 목표 도달 (순수익 ${netPct.toFixed(1)}%)` },
      "long",
      "value_target",
    );
  }

  if (!candles?.length || candles.length < 60) return null;

  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  const i = closes.length - 1;
  const ma200 = closes.length >= 200 ? ema(closes, 200)[i] : null;
  if (ma200 != null && currentPrice < ma200 * 0.985 && netPct < 5) {
    return finalizeHit(
      {
        price: currentPrice,
        note: "일봉 200EMA 하향 이탈 — 중기 추세 훼손",
      },
      "long",
      "ma200_break",
    );
  }

  const swingLow = recentSwingLow(candles, 20);
  if (swingLow != null && currentPrice < swingLow * 0.97) {
    return finalizeHit(
      {
        price: currentPrice,
        note: "일봉 구조적 지지 붕괴",
      },
      "long",
      "structure_break",
    );
  }

  const holdDays = (Date.now() - (pos.boughtAtMs ?? Date.now())) / 86_400_000;
  if (holdDays >= 90 && netPct < 3) {
    return finalizeHit(
      {
        price: currentPrice,
        note: `장기 보유 ${holdDays.toFixed(0)}일 — 가치 실현 지연 (${netPct.toFixed(1)}%)`,
      },
      "long",
      "time_stop",
    );
  }

  return null;
}

/**
 * @param {Parameters<typeof evaluateShortTermSell>[0]} pos
 * @param {{ sellHorizon?: string }} program
 * @param {number | null} currentPrice
 * @param {unknown[]} candles
 * @param {{ roundTripFeeRate?: number }} [ctx]
 */
export function evaluateLiveTradeSellDecision(
  pos,
  program,
  currentPrice,
  candles,
  ctx = {},
) {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }
  const horizon = resolveProgramSellHorizon(program);
  switch (horizon) {
    case "medium":
      return evaluateMediumTermSell(pos, currentPrice, candles, ctx);
    case "long":
      return evaluateLongTermSell(pos, currentPrice, candles, ctx);
    default:
      return evaluateShortTermSell(pos, currentPrice, candles, ctx);
  }
}

/**
 * @param {string} symbol
 * @param {LiveTradeSellHorizon} horizon
 */
export async function loadCandlesForSellHorizon(symbol, horizon) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return [];
  try {
    if (horizon === "short") {
      const data = await loadStock(sym, "5m", { live: true });
      return data?.candles ?? [];
    }
    if (horizon === "medium") {
      const data = await loadStock(sym, "1h", { live: true });
      return data?.candles ?? [];
    }
    const data = await loadStock(sym, "1d");
    return data?.candles ?? [];
  } catch {
    return [];
  }
}
