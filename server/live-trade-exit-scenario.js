/**
 * 매수 시 종목별 일봉·변동성·지지·저항으로 목표·손절가 자동 산정
 */
import { loadStock } from "./stock-data.js";
import { netReturnPct } from "./net-return.js";
import {
  stopLossPriceFromPct,
  targetSellPriceFromTakeProfit,
} from "./live-trade-sell-target.js";
import { analyzeTechnicals } from "./technical.js";
import { analyzeTradeStructure } from "./trade-structure-analysis.js";

const MIN_STOP_NET_PCT = -15;
const MAX_STOP_NET_PCT = -1.2;
const MIN_TP_NET_PCT = 2;
const MAX_TP_NET_PCT = 28;
const MIN_RR = 1.25;
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
  if (market === "kr") return Math.max(1, Math.round(price));
  return Math.round(price * 100) / 100;
}

/**
 * @param {number} entry
 * @param {number} rawStop
 */
function stopNetPctFromRaw(entry, rawStop) {
  if (!Number.isFinite(rawStop) || rawStop >= entry) return MAX_STOP_NET_PCT;
  const pct = netReturnPct(entry, rawStop);
  return Math.max(MIN_STOP_NET_PCT, Math.min(MAX_STOP_NET_PCT, pct));
}

/**
 * @param {number} entry
 * @param {number} rawTarget
 */
function targetNetPctFromRaw(entry, rawTarget) {
  if (!Number.isFinite(rawTarget) || rawTarget <= entry) return MIN_TP_NET_PCT;
  const pct = netReturnPct(entry, rawTarget);
  return Math.max(MIN_TP_NET_PCT, Math.min(MAX_TP_NET_PCT, pct));
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
 * @param {unknown[]} candles
 * @param {number} entryPrice
 * @param {"kr"|"us"} market
 * @param {{ signalIds?: string[]; score?: number }} [ctx]
 */
export function computeExitScenarioFromCandles(candles, entryPrice, market, ctx = {}) {
  const entry = Number(entryPrice);
  const mkt = market === "us" ? "us" : "kr";
  if (!Number.isFinite(entry) || entry <= 0) {
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

  let signalIds = Array.isArray(ctx.signalIds) ? ctx.signalIds : [];
  if (!signalIds.length && candles.length >= 55) {
    signalIds = analyzeTechnicals(candles).signalIds ?? [];
  }
  const adj = signalAdjustments(signalIds);

  if (!candles || candles.length < 25) {
    const stopNet = adj.stopTighter ? -2.5 : adj.stopWider ? -4 : -3;
    const tpNet = adj.targetBoost > 1 ? 6.5 : 5;
    return finalizeScenario(entry, mkt, stopNet, tpNet, [
      "차트 데이터 부족 — 보수적 기본 시나리오",
      ...adj.labels,
    ]);
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

  let stopNet = stopNetPctFromRaw(entry, stopRaw);
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
  if (high60 != null && high60 > entry * 1.01) {
    tpCandidates.push(high60 * (adj.targetBoost > 1.03 ? 0.998 : 0.992));
  }
  if (atr != null) {
    tpCandidates.push(entry + atr * (2 + (adj.targetBoost - 1) * 4));
    tpCandidates.push(entry + atr * 2.8);
  }
  tpCandidates.push(entry * (1 + (atrPct != null ? Math.min(0.12, atrPct / 100 * 2.5) : 0.05)));

  let targetRaw = Math.min(
    ...tpCandidates.filter((x) => Number.isFinite(x) && x > entry * 1.004),
  );
  if (!Number.isFinite(targetRaw)) targetRaw = entry * 1.05;
  targetRaw *= adj.targetBoost;

  const stopPrice = stopLossPriceFromPct(entry, stopNet);
  const risk =
    stopPrice != null && stopPrice < entry ? entry - stopPrice : entry * 0.03;
  let reward = targetRaw - entry;
  if (risk > 0 && reward / risk < MIN_RR) {
    targetRaw = entry + risk * MIN_RR;
  }

  let tpNet = targetNetPctFromRaw(entry, targetRaw);
  if (risk > 0) {
    const impliedTp = (targetRaw / entry - 1) * 100;
    tpNet = Math.max(tpNet, Math.min(MAX_TP_NET_PCT, impliedTp * 0.95));
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
  if (high60 != null && high60 > entry * 1.02) reasons.push("60일 고점권");
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
      ? ((targetSellPriceFromTakeProfit(entry, tpNet) ?? entry) - entry) /
        (entry - stopPrice)
      : null;

  const noteParts = [
    reasons.length ? reasons.join(" · ") : "일봉 기준 자동 산정",
    `손익비 약 ${rr != null && Number.isFinite(rr) ? rr.toFixed(1) : "—"}:1`,
    `목표 순수익 ${tpNet.toFixed(1)}% · 손절 ${stopNet.toFixed(1)}%`,
  ];

  return finalizeScenario(entry, mkt, stopNet, tpNet, noteParts, {
    entryStructureNote,
    entryIdeal: Boolean(structure.entryIdeal),
    entryKind: structure.entryKind ?? "none",
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
  let stopLossPrice = stopLossPriceFromPct(entry, stopNet);
  let targetSellPrice = targetSellPriceFromTakeProfit(entry, tpNet);
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
 * @param {string} symbol
 * @param {number} entryPrice
 * @param {{ market?: string; signalIds?: string[]; score?: number }} [ctx]
 */
export async function resolveLiveTradeExitTargets(symbol, entryPrice, ctx = {}) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const market = ctx.market === "us" ? "us" : "kr";
  try {
    const data = await loadStock(sym, "1d");
    const candles =
      (data?.candles?.length ? data.candles : null) ??
      (data?.dailyCandles?.length ? data.dailyCandles : null) ??
      [];
    return computeExitScenarioFromCandles(candles, entryPrice, market, ctx);
  } catch {
    return computeExitScenarioFromCandles([], entryPrice, market, ctx);
  }
}
