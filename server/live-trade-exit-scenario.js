/**
 * 매수 시 목표·손절가 자동 산정
 * - 단타(short): 5분봉 + 일봉 매물대 상한
 * - 스윙(medium/long): 일봉 구조·매물대·일목
 */
import { loadStock } from "./stock-data.js";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  netReturnPct,
} from "./net-return.js";
import {
  stopLossPriceFromPct,
  targetSellPriceFromTakeProfit,
} from "./live-trade-sell-target.js";
import { analyzeTechnicals } from "./technical.js";
import { analyzeTradeStructure } from "./trade-structure-analysis.js";
import { normalizeLiveTradeMarket } from "./live-trade-market.js";
import { normalizeSellHorizon } from "./live-trade-sell-strategy.js";

const MIN_STOP_NET_PCT = -15;
const MAX_STOP_NET_PCT = -1.2;

/** 단타 — 몇 시간~하루 내 현실적 범위 */
export const SHORT_EXIT_LIMITS = {
  minTpNetPct: 0.9,
  maxTpNetPctKr: 3,
  maxTpNetPctUs: 3.2,
  maxTpNetPctCrypto: 4.2,
  minStopNetPct: -2.8,
  maxStopNetPct: -1,
  minRr: 1.08,
};

/** 스윙 — 일봉 매물대·구조 (중기/장기 상한 분리) */
export const SWING_EXIT_LIMITS = {
  minTpNetPct: 2,
  maxTpNetPctMedium: 12,
  maxTpNetPctLong: 22,
  minRrMedium: 1.2,
  minRrLong: 1.25,
};

export const LIVE_TRADE_EXIT_SCENARIO_VERSION = 3;
const ICHI_SHIFT = 26;
const VP_LOOKBACK = 40;
const VP_BINS = 10;

/**
 * @param {unknown[]} candles
 * @param {number} i
 */
function trueRangeAt(candles, i) {
  const c = candles[i];
  const prev = candles[i - 1];
  if (!c || !prev) return null;
  const h = Number(c.high ?? c.close);
  const l = Number(c.low ?? c.close);
  const pc = Number(prev.close);
  if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) return null;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

/**
 * @param {unknown[]} candles
 */
function atr14(candles) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = trueRangeAt(candles, i);
    if (tr != null && tr > 0) trs.push(tr);
  }
  if (trs.length < 14) return null;
  const slice = trs.slice(-14);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * @param {unknown[]} candles
 * @param {number} lookback
 */
function swingLow(candles, lookback = 20) {
  const slice = candles.slice(-lookback - 1, -1);
  let min = Infinity;
  for (const c of slice) {
    const l = Number(c.low ?? c.close);
    if (Number.isFinite(l) && l < min) min = l;
  }
  return Number.isFinite(min) ? min : null;
}

/**
 * @param {unknown[]} candles
 * @param {number} lookback
 */
function swingHigh(candles, lookback = 20) {
  const slice = candles.slice(-lookback - 1, -1);
  let max = -Infinity;
  for (const c of slice) {
    const h = Number(c.high ?? c.close);
    if (Number.isFinite(h) && h > max) max = h;
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * @param {unknown[]} candles
 * @param {number} days
 */
function highNDays(candles, days = 60) {
  const slice = candles.slice(-days);
  let max = -Infinity;
  for (const c of slice) {
    const h = Number(c.high ?? c.close);
    if (Number.isFinite(h) && h > max) max = h;
  }
  return Number.isFinite(max) ? max : null;
}

/**
 * @param {number} price
 * @param {"kr"|"us"} market
 */
function roundExitPrice(price, market) {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (market === "kr" || market === "crypto") return Math.max(1, Math.round(price));
  return Math.round(price * 100) / 100;
}

/**
 * @param {number} entry
 * @param {number} rawStop
 */
function stopNetPctFromRaw(
  entry,
  rawStop,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  if (!Number.isFinite(rawStop) || rawStop >= entry) return MAX_STOP_NET_PCT;
  const pct = netReturnPct(entry, rawStop, roundTripFeeRate);
  return Math.max(MIN_STOP_NET_PCT, Math.min(MAX_STOP_NET_PCT, pct));
}

/**
 * @param {number} entry
 * @param {number} rawTarget
 * @param {number} [roundTripFeeRate]
 */
function targetNetPctFromRaw(
  entry,
  rawTarget,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
  minTp = SWING_EXIT_LIMITS.minTpNetPct,
  maxTp = SWING_EXIT_LIMITS.maxTpNetPctLong,
) {
  if (!Number.isFinite(rawTarget) || rawTarget <= entry) return minTp;
  const pct = netReturnPct(entry, rawTarget, roundTripFeeRate);
  return Math.max(minTp, Math.min(maxTp, pct));
}

function clampNetPct(pct, min, max) {
  return Math.max(min, Math.min(max, pct));
}

/**
 * @param {"kr"|"us"|"crypto"} market
 */
function maxShortTpNetPct(market) {
  if (market === "crypto") return SHORT_EXIT_LIMITS.maxTpNetPctCrypto;
  if (market === "us") return SHORT_EXIT_LIMITS.maxTpNetPctUs;
  return SHORT_EXIT_LIMITS.maxTpNetPctKr;
}

function emptyExitScenario() {
  return {
    targetSellPrice: null,
    stopLossPrice: null,
    exitScenarioNote: null,
    entryStructureNote: null,
    entryIdeal: false,
    entryKind: "none",
    takeProfitNetPct: null,
    stopLossNetPct: null,
  };
}

/**
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number} period
 */
function midline(highs, lows, period) {
  const out = new Array(highs.length).fill(null);
  for (let i = period - 1; i < highs.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = 0; j < period; j++) {
      h = Math.max(h, highs[i - j]);
      l = Math.min(l, lows[i - j]);
    }
    out[i] = (h + l) / 2;
  }
  return out;
}

/**
 * @param {unknown[]} candles
 */
function ichimokuAtLastBar(candles) {
  const n = candles.length;
  if (n < 55) return null;
  const i = n - 1;
  const highs = candles.map((c) => Number(c.high ?? c.close));
  const lows = candles.map((c) => Number(c.low ?? c.close));
  const tenkan = midline(highs, lows, 9);
  const kijun = midline(highs, lows, 26);
  const spanB = midline(highs, lows, 52);
  const spanA = tenkan.map((t, idx) =>
    t != null && kijun[idx] != null ? (t + kijun[idx]) / 2 : null,
  );
  const src = i - ICHI_SHIFT;
  if (src < 0) return null;
  const sa = spanA[src];
  const sb = spanB[src];
  if (sa == null || sb == null || !Number.isFinite(sa) || !Number.isFinite(sb)) {
    return null;
  }
  const cloudTop = Math.max(sa, sb);
  const cloudBottom = Math.min(sa, sb);
  const entry = Number(candles[i].close);
  const kj = kijun[i];
  const tk = tenkan[i];
  return {
    spanA: sa,
    spanB: sb,
    cloudTop,
    cloudBottom,
    kijun: kj != null && Number.isFinite(kj) ? kj : null,
    tenkan: tk != null && Number.isFinite(tk) ? tk : null,
    aboveCloud: Number.isFinite(entry) && entry > cloudTop,
    belowCloud: Number.isFinite(entry) && entry < cloudBottom,
    inCloud:
      Number.isFinite(entry) &&
      entry >= cloudBottom &&
      entry <= cloudTop,
    bullishCloud: sa >= sb,
  };
}

/**
 * 최근 구간 거래량 집중(매물대 POC) — technical.js volumeProfileBreakout 과 동일 bin
 * @param {unknown[]} candles
 * @param {number} [lookback]
 */
function volumeProfileAtLastBar(candles, lookback = VP_LOOKBACK) {
  const n = candles.length;
  if (n < 20) return null;
  const i = n - 1;
  const start = Math.max(0, i - lookback + 1);
  const slice = candles.slice(start, i + 1);
  if (slice.length < 20) return null;

  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of slice) {
    const lo = Number(c.low ?? c.close);
    const hi = Number(c.high ?? c.close);
    if (Number.isFinite(lo)) minP = Math.min(minP, lo);
    if (Number.isFinite(hi)) maxP = Math.max(maxP, hi);
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) return null;

  const volByBin = new Array(VP_BINS).fill(0);
  for (const c of slice) {
    const mid = (Number(c.high) + Number(c.low)) / 2;
    const b = Math.min(
      VP_BINS - 1,
      Math.floor(((mid - minP) / (maxP - minP)) * VP_BINS),
    );
    const vol = Number(c.volume);
    volByBin[b] += Number.isFinite(vol) && vol > 0 ? vol : 0;
  }
  let pocBin = 0;
  for (let b = 1; b < VP_BINS; b++) {
    if (volByBin[b] > volByBin[pocBin]) pocBin = b;
  }
  const binSize = (maxP - minP) / VP_BINS;
  const pocBottom = minP + pocBin * binSize;
  const pocTop = minP + (pocBin + 1) * binSize;
  const pocMid = (pocBottom + pocTop) / 2;
  return { pocBottom, pocTop, pocMid, minP, maxP, pocBin };
}

/**
 * @param {string[]} signalIds
 */
function signalAdjustments(signalIds) {
  const ids = new Set(signalIds ?? []);
  return {
    stopTighter: ids.has("volume_surge") || ids.has("vp_breakout"),
    stopWider: ids.has("rsi") || ids.has("ma_golden"),
    targetBoost:
      (ids.has("high_60") ? 1.04 : 1) *
      (ids.has("vp_breakout") ? 1.03 : 1) *
      (ids.has("macd") ? 1.02 : 1),
    labels: [
      ids.has("high_60") ? "60일 고점 근접" : null,
      ids.has("vp_breakout") ? "매물대 돌파" : null,
      ids.has("rsi") ? "RSI 상승" : null,
      ids.has("volume_surge") ? "거래량 급증" : null,
      ids.has("ma_golden") ? "골든크로스" : null,
    ].filter(Boolean),
  };
}

/**
 * 단타 — 5분봉 기준, 일봉 매물대는 익절 상한만
 * @param {{
 *   dailyCandles?: unknown[];
 *   intradayCandles?: unknown[];
 *   entryPrice: number;
 *   market?: string;
 *   signalIds?: string[];
 *   roundTripFeeRate?: number;
 * }} input
 */
export function computeShortTermExitScenario(input) {
  const roundTripFeeRate =
    typeof input.roundTripFeeRate === "number" &&
    Number.isFinite(input.roundTripFeeRate)
      ? input.roundTripFeeRate
      : DEFAULT_ROUND_TRIP_FEE_RATE;
  const entry = Number(input.entryPrice);
  const symMarket = normalizeLiveTradeMarket(input.market, "");
  const mkt =
    symMarket === "us" ? "us" : symMarket === "crypto" ? "crypto" : "kr";
  if (!Number.isFinite(entry) || entry <= 0) return emptyExitScenario();

  const daily = input.dailyCandles ?? [];
  const intra = input.intradayCandles ?? [];
  const maxTpNet = maxShortTpNetPct(mkt);
  const vpDaily =
    daily.length >= 20 ? volumeProfileAtLastBar(daily, VP_LOOKBACK) : null;

  let dailyCapRaw = entry * (1 + (maxTpNet / 100) * 1.08);
  if (vpDaily != null && vpDaily.pocTop > entry) {
    dailyCapRaw = Math.min(dailyCapRaw, vpDaily.pocTop * 0.996);
  }

  const fmt = (p) =>
    mkt === "kr" || mkt === "crypto"
      ? `${Math.round(p).toLocaleString("ko-KR")}원`
      : `$${p.toFixed(2)}`;

  /** @type {string[]} */
  const reasons = ["단타(5분)"];
  if (vpDaily != null) {
    reasons.push(`일봉 매물대 상단 ${fmt(vpDaily.pocTop)} 캡`);
  }

  if (intra.length < 20) {
    const atrD = daily.length >= 15 ? atr14(daily) : null;
    const high5 = daily.length >= 6 ? swingHigh(daily, 5) : null;
    let tpRaw = entry + (atrD != null ? atrD * 0.35 : entry * 0.008);
    if (high5 != null && high5 > entry) tpRaw = Math.min(tpRaw, high5 * 0.998);
    tpRaw = Math.min(tpRaw, dailyCapRaw);
    const low5 = daily.length >= 6 ? swingLow(daily, 5) : null;
    let stopRaw = entry * 0.988;
    if (low5 != null && low5 < entry) stopRaw = Math.max(stopRaw, low5 * 0.997);
    if (atrD != null) stopRaw = Math.max(stopRaw, entry - atrD * 0.45);

    let stopNet = clampNetPct(
      stopNetPctFromRaw(entry, stopRaw, roundTripFeeRate),
      SHORT_EXIT_LIMITS.minStopNetPct,
      SHORT_EXIT_LIMITS.maxStopNetPct,
    );
    let tpNet = targetNetPctFromRaw(
      entry,
      tpRaw,
      roundTripFeeRate,
      SHORT_EXIT_LIMITS.minTpNetPct,
      maxTpNet,
    );
    reasons.push("5분 데이터 부족 — 일봉 보조");
    return finalizeScenario(entry, mkt, stopNet, tpNet, [
      ...reasons,
      `목표 순수익 ${tpNet.toFixed(1)}% · 손절 ${stopNet.toFixed(1)}%`,
    ], { roundTripFeeRate, entryKind: "short_intraday_fallback" });
  }

  const atr5 = atr14(intra);
  const atrPct5 = atr5 != null && atr5 > 0 ? (atr5 / entry) * 100 : null;
  const high18 = swingHigh(intra, 18);
  const high36 = swingHigh(intra, 36);
  const low12 = swingLow(intra, 12);

  const tpCandidates = [];
  if (atr5 != null) {
    tpCandidates.push(entry + atr5 * 0.72);
    tpCandidates.push(entry + atr5 * 1.02);
  }
  if (high18 != null && high18 > entry * 1.0015) {
    tpCandidates.push(high18 * 0.998);
  }
  if (
    high36 != null &&
    high36 > entry * 1.002 &&
    high36 <= dailyCapRaw * 1.008
  ) {
    tpCandidates.push(high36 * 0.997);
  }
  tpCandidates.push(
    entry * (1 + Math.min(0.022, ((atrPct5 ?? 1.1) / 100) * 0.62)),
  );

  let targetRaw = Math.min(
    ...tpCandidates.filter(
      (x) => Number.isFinite(x) && x > entry * 1.0012 && x <= dailyCapRaw,
    ),
  );
  if (!Number.isFinite(targetRaw)) {
    targetRaw = Math.min(dailyCapRaw, entry * (1 + maxTpNet / 100));
  }

  const stopCandidates = [];
  if (low12 != null && low12 < entry) stopCandidates.push(low12 * 0.997);
  if (atr5 != null) stopCandidates.push(entry - atr5 * 1.12);
  stopCandidates.push(entry * 0.988);

  let stopRaw = Math.max(
    ...stopCandidates.filter((x) => Number.isFinite(x) && x > 0 && x < entry * 0.999),
  );
  if (!Number.isFinite(stopRaw)) stopRaw = entry * 0.985;

  let stopNet = clampNetPct(
    stopNetPctFromRaw(entry, stopRaw, roundTripFeeRate),
    SHORT_EXIT_LIMITS.minStopNetPct,
    SHORT_EXIT_LIMITS.maxStopNetPct,
  );
  let tpNet = targetNetPctFromRaw(
    entry,
    targetRaw,
    roundTripFeeRate,
    SHORT_EXIT_LIMITS.minTpNetPct,
    maxTpNet,
  );

  const stopPrice = stopLossPriceFromPct(entry, stopNet, roundTripFeeRate);
  const risk =
    stopPrice != null && stopPrice < entry ? entry - stopPrice : entry * 0.012;
  if (risk > 0) {
    const minTarget = entry + risk * SHORT_EXIT_LIMITS.minRr;
    if (targetRaw > minTarget) targetRaw = minTarget;
    tpNet = targetNetPctFromRaw(
      entry,
      targetRaw,
      roundTripFeeRate,
      SHORT_EXIT_LIMITS.minTpNetPct,
      maxTpNet,
    );
  }

  if (atrPct5 != null) reasons.push(`5분 ATR ${atrPct5.toFixed(2)}%`);
  if (high18 != null && high18 > entry) {
    reasons.push(`근접 고점 ${fmt(high18)}`);
  }

  return finalizeScenario(entry, mkt, stopNet, tpNet, [
    reasons.join(" · "),
    `목표 순수익 ${tpNet.toFixed(1)}% · 손절 ${stopNet.toFixed(1)}%`,
  ], { roundTripFeeRate, entryKind: "short_intraday" });
}

/**
 * 스윙 — 일봉·매물대·구조 (medium/long)
 * @param {unknown[]} candles
 * @param {number} entryPrice
 * @param {"kr"|"us"|"crypto"} market
 * @param {{ signalIds?: string[]; score?: number; sellHorizon?: string; roundTripFeeRate?: number }} [ctx]
 */
export function computeSwingExitScenarioFromDailyCandles(
  candles,
  entryPrice,
  market,
  ctx = {},
) {
  const roundTripFeeRate =
    typeof ctx.roundTripFeeRate === "number" && Number.isFinite(ctx.roundTripFeeRate)
      ? ctx.roundTripFeeRate
      : DEFAULT_ROUND_TRIP_FEE_RATE;
  const entry = Number(entryPrice);
  const mkt =
    market === "us" ? "us" : market === "crypto" ? "crypto" : "kr";
  const horizon = normalizeSellHorizon(ctx.sellHorizon ?? "medium");
  const maxTpNet =
    horizon === "long"
      ? SWING_EXIT_LIMITS.maxTpNetPctLong
      : SWING_EXIT_LIMITS.maxTpNetPctMedium;
  const minRr =
    horizon === "long"
      ? SWING_EXIT_LIMITS.minRrLong
      : SWING_EXIT_LIMITS.minRrMedium;
  if (!Number.isFinite(entry) || entry <= 0) return emptyExitScenario();

  let signalIds = Array.isArray(ctx.signalIds) ? ctx.signalIds : [];
  if (!signalIds.length && candles.length >= 55) {
    signalIds = analyzeTechnicals(candles).signalIds ?? [];
  }
  const adj = signalAdjustments(signalIds);

  if (!candles || candles.length < 25) {
    const stopNet = adj.stopTighter ? -2.5 : adj.stopWider ? -4 : -3;
    const tpNet = clampNetPct(
      adj.targetBoost > 1 ? 5.5 : 4,
      SWING_EXIT_LIMITS.minTpNetPct,
      maxTpNet,
    );
    return finalizeScenario(entry, mkt, stopNet, tpNet, [
      `스윙(일봉·${horizon === "long" ? "장기" : "중기"}) — 데이터 부족`,
      ...adj.labels,
    ], { roundTripFeeRate });
  }

  const atr = atr14(candles);
  const low20 = swingLow(candles, 20);
  const high20 = swingHigh(candles, 20);
  const high60 = highNDays(candles, 60);
  const atrPct = atr != null && atr > 0 ? (atr / entry) * 100 : null;
  const vp = volumeProfileAtLastBar(candles);
  const ichi = ichimokuAtLastBar(candles);
  const structure = analyzeTradeStructure(candles, entry);

  const stopCandidates = [];
  if (ichi != null) {
    if (ichi.aboveCloud && ichi.kijun != null && ichi.kijun < entry) {
      stopCandidates.push(ichi.kijun * 0.997);
    }
    if (ichi.inCloud || (ichi.aboveCloud && entry < ichi.cloudTop * 1.02)) {
      stopCandidates.push(ichi.cloudBottom * (adj.stopTighter ? 0.997 : 0.994));
    }
    if (ichi.belowCloud) {
      stopCandidates.push(ichi.cloudBottom * 0.992);
    }
  }
  if (vp != null && vp.pocBottom < entry) {
    stopCandidates.push(vp.pocBottom * (adj.stopTighter ? 0.998 : 0.995));
  }
  if (structure.vpLong?.val != null && structure.vpLong.val < entry) {
    stopCandidates.push(structure.vpLong.val * 0.996);
  }
  if (structure.angledSupport != null && structure.angledSupport < entry) {
    stopCandidates.push(structure.angledSupport * 0.997);
  }
  if (structure.entrySetup?.stopLevel != null && structure.entrySetup.stopLevel < entry) {
    stopCandidates.push(structure.entrySetup.stopLevel * 0.998);
  }
  if (structure.trendSupport != null && structure.trendSupport < entry) {
    stopCandidates.push(structure.trendSupport * 0.996);
  }
  if (low20 != null && low20 < entry) {
    stopCandidates.push(low20 * (adj.stopTighter ? 0.998 : 0.995));
  }
  if (atr != null) {
    stopCandidates.push(entry - atr * (adj.stopWider ? 2.2 : 1.6));
    stopCandidates.push(entry - atr * 2.4);
  }
  stopCandidates.push(entry * (adj.stopTighter ? 0.985 : 0.978));

  let stopRaw = Math.max(
    ...stopCandidates.filter((x) => Number.isFinite(x) && x > 0 && x < entry * 0.998),
  );
  if (!Number.isFinite(stopRaw)) stopRaw = entry * 0.97;

  let stopNet = stopNetPctFromRaw(entry, stopRaw, roundTripFeeRate);
  if (adj.stopTighter) stopNet = Math.min(stopNet, -1.8);
  if (adj.stopWider) stopNet = Math.max(stopNet, -5.5);

  const tpCandidates = [];
  if (vp != null) {
    if (vp.pocTop > entry) tpCandidates.push(vp.pocTop * 0.998);
    if (vp.maxP > entry * 1.01) tpCandidates.push(vp.maxP * 0.995);
  }
  if (structure.vpLong?.vah != null && structure.vpLong.vah > entry) {
    tpCandidates.push(structure.vpLong.vah * 0.997);
  }
  if (structure.trendResistance != null && structure.trendResistance > entry) {
    tpCandidates.push(structure.trendResistance * 0.998);
  }
  if (structure.entrySetup?.kind === "breakout_retest" && structure.vpLong?.vah != null) {
    tpCandidates.push(structure.vpLong.vah * 1.002);
  }
  if (ichi != null) {
    if (ichi.aboveCloud) {
      const spanRes = Math.max(ichi.spanA, ichi.spanB);
      if (spanRes > entry) tpCandidates.push(spanRes * 1.002);
      tpCandidates.push(entry + (ichi.cloudTop - ichi.cloudBottom) * 0.8);
    } else if (ichi.inCloud || entry < ichi.cloudTop) {
      tpCandidates.push(ichi.cloudTop * (ichi.bullishCloud ? 0.999 : 0.997));
    }
    if (ichi.belowCloud && ichi.cloudTop > entry) {
      tpCandidates.push(ichi.cloudTop * 0.997);
    }
  }
  if (high20 != null && high20 > entry) tpCandidates.push(high20 * 0.997);
  if (horizon === "long" && high60 != null && high60 > entry * 1.01) {
    tpCandidates.push(high60 * (adj.targetBoost > 1.03 ? 0.998 : 0.992));
  }
  if (atr != null) {
    const atrMult =
      horizon === "long" ? 2 + (adj.targetBoost - 1) * 3 : 1.35 + (adj.targetBoost - 1) * 1.5;
    tpCandidates.push(entry + atr * atrMult);
    if (horizon === "long") tpCandidates.push(entry + atr * 2.2);
  }
  const swingTpCapPct =
    horizon === "long" ? 0.1 : 0.065;
  tpCandidates.push(
    entry * (1 + (atrPct != null ? Math.min(swingTpCapPct, atrPct / 100 * 1.6) : 0.04)),
  );

  let targetRaw = Math.min(
    ...tpCandidates.filter((x) => Number.isFinite(x) && x > entry * 1.004),
  );
  if (!Number.isFinite(targetRaw)) targetRaw = entry * (1 + maxTpNet / 100 * 0.45);
  targetRaw = Math.min(targetRaw * adj.targetBoost, entry * (1 + maxTpNet / 100 * 1.06));

  const stopPrice = stopLossPriceFromPct(entry, stopNet);
  const risk =
    stopPrice != null && stopPrice < entry ? entry - stopPrice : entry * 0.03;
  let reward = targetRaw - entry;
  if (risk > 0 && reward / risk < minRr) {
    targetRaw = entry + risk * minRr;
  }
  targetRaw = Math.min(targetRaw, entry * (1 + maxTpNet / 100 * 1.06));

  let tpNet = targetNetPctFromRaw(
    entry,
    targetRaw,
    roundTripFeeRate,
    SWING_EXIT_LIMITS.minTpNetPct,
    maxTpNet,
  );
  if (risk > 0) {
    const impliedTp = (targetRaw / entry - 1) * 100;
    tpNet = clampNetPct(impliedTp * 0.95, SWING_EXIT_LIMITS.minTpNetPct, maxTpNet);
    if (netReturnPct(entry, targetRaw, roundTripFeeRate) < SWING_EXIT_LIMITS.minTpNetPct) {
      tpNet = SWING_EXIT_LIMITS.minTpNetPct;
    }
  }

  const fmt = (p) =>
    mkt === "kr"
      ? `${Math.round(p).toLocaleString("ko-KR")}원`
      : `$${p.toFixed(2)}`;
  const reasons = [];
  if (vp != null) {
    reasons.push(`매물대 POC ${fmt(vp.pocMid)} (상단 ${fmt(vp.pocTop)})`);
  }
  if (ichi != null) {
    const cloudLabel = ichi.aboveCloud
      ? "구름 위"
      : ichi.belowCloud
        ? "구름 아래"
        : "구름 안";
    reasons.push(
      `일목 선행스팬 ${cloudLabel} · A ${fmt(ichi.spanA)} B ${fmt(ichi.spanB)}`,
    );
    if (ichi.kijun != null && ichi.kijun < entry) {
      reasons.push(`기준선 ${fmt(ichi.kijun)}`);
    }
  }
  if (low20 != null) reasons.push(`20일 저점 ${fmt(low20)} 지지`);
  if (atrPct != null) reasons.push(`ATR ${atrPct.toFixed(1)}%`);
  if (high20 != null && high20 > entry) {
    reasons.push(`20일 고점 ${fmt(high20)} 저항`);
  }
  if (horizon === "long" && high60 != null && high60 > entry * 1.02) {
    reasons.push("60일 고점권");
  }
  if (adj.labels.length) reasons.push(adj.labels.join("·"));
  if (structure.labels?.length) {
    reasons.push(structure.labels.slice(0, 4).join(" · "));
  }
  if (structure.entryIdeal) {
    reasons.push("구조적 진입 우호");
  }

  const entryStructureNote = structure.labels?.length
    ? structure.labels.join(" · ").slice(0, 280)
    : null;

  const rr =
    stopPrice != null && stopPrice < entry
      ? ((targetSellPriceFromTakeProfit(entry, tpNet, roundTripFeeRate) ??
          entry) -
          entry) /
        (entry - stopPrice)
      : null;

  const noteParts = [
    reasons.length
      ? `스윙(일봉·${horizon === "long" ? "장기" : "중기"}) — ${reasons.join(" · ")}`
      : `스윙(일봉·${horizon === "long" ? "장기" : "중기"})`,
    `손익비 약 ${rr != null && Number.isFinite(rr) ? rr.toFixed(1) : "—"}:1`,
    `목표 순수익 ${tpNet.toFixed(1)}% · 손절 ${stopNet.toFixed(1)}%`,
  ];

  return finalizeScenario(entry, mkt, stopNet, tpNet, noteParts, {
    entryStructureNote,
    entryIdeal: Boolean(structure.entryIdeal),
    entryKind: structure.entryKind ?? "none",
    roundTripFeeRate,
  });
}

/**
 * @param {number} entry
 * @param {"kr"|"us"} market
 * @param {number} stopNet
 * @param {number} tpNet
 * @param {string[]} noteParts
 */
/**
 * @param {string[]} noteParts
 * @param {{ entryStructureNote?: string | null; entryIdeal?: boolean; entryKind?: string }} [meta]
 */
function finalizeScenario(entry, market, stopNet, tpNet, noteParts, meta = {}) {
  const fee =
    typeof meta.roundTripFeeRate === "number" && Number.isFinite(meta.roundTripFeeRate)
      ? meta.roundTripFeeRate
      : DEFAULT_ROUND_TRIP_FEE_RATE;
  let stopLossPrice = stopLossPriceFromPct(entry, stopNet, fee);
  let targetSellPrice = targetSellPriceFromTakeProfit(entry, tpNet, fee);
  stopLossPrice = roundExitPrice(stopLossPrice, market);
  targetSellPrice = roundExitPrice(targetSellPrice, market);
  if (
    stopLossPrice != null &&
    targetSellPrice != null &&
    stopLossPrice >= targetSellPrice
  ) {
    targetSellPrice = roundExitPrice(entry * 1.04, market);
  }
  return {
    targetSellPrice,
    stopLossPrice,
    exitScenarioNote: noteParts.filter(Boolean).join(" — ").slice(0, 400),
    entryStructureNote: meta.entryStructureNote ?? null,
    entryIdeal: Boolean(meta.entryIdeal),
    entryKind: meta.entryKind ?? "none",
    takeProfitNetPct: tpNet,
    stopLossNetPct: stopNet,
  };
}

/**
 * @param {unknown[]} candles
 * @param {number} entryPrice
 * @param {"kr"|"us"|"crypto"} market
 * @param {{ signalIds?: string[]; sellHorizon?: string }} [ctx]
 */
export function computeExitScenarioFromCandles(candles, entryPrice, market, ctx = {}) {
  const horizon = normalizeSellHorizon(ctx.sellHorizon ?? "short");
  if (horizon === "short") {
    return computeShortTermExitScenario({
      dailyCandles: candles,
      intradayCandles: ctx.intradayCandles ?? [],
      entryPrice,
      market,
      signalIds: ctx.signalIds,
      roundTripFeeRate: ctx.roundTripFeeRate,
    });
  }
  return computeSwingExitScenarioFromDailyCandles(candles, entryPrice, market, ctx);
}

/**
 * @param {string} symbol
 * @param {number} entryPrice
 * @param {{ market?: string; signalIds?: string[]; score?: number; sellHorizon?: string; roundTripFeeRate?: number }} [ctx]
 */
export async function resolveLiveTradeExitTargets(symbol, entryPrice, ctx = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const market = normalizeLiveTradeMarket(ctx.market, sym);
  const horizon = normalizeSellHorizon(ctx.sellHorizon ?? "short");

  let dailyCandles = [];
  try {
    const data = await loadStock(sym, "1d");
    dailyCandles =
      (data?.candles?.length ? data.candles : null) ??
      (data?.dailyCandles?.length ? data.dailyCandles : null) ??
      [];
  } catch {
    dailyCandles = [];
  }

  if (horizon === "short") {
    let intradayCandles = [];
    try {
      const intra = await loadStock(sym, "5m", { live: true });
      intradayCandles = intra?.candles ?? [];
    } catch {
      intradayCandles = [];
    }
    return computeShortTermExitScenario({
      dailyCandles,
      intradayCandles,
      entryPrice,
      market,
      signalIds: ctx.signalIds,
      roundTripFeeRate: ctx.roundTripFeeRate,
    });
  }

  try {
    return computeSwingExitScenarioFromDailyCandles(
      dailyCandles,
      entryPrice,
      market,
      { ...ctx, sellHorizon: horizon },
    );
  } catch {
    return computeSwingExitScenarioFromDailyCandles([], entryPrice, market, {
      ...ctx,
      sellHorizon: horizon,
    });
  }
}
