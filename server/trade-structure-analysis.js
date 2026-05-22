/**
 * 매물대(단기·장기 빗각), 추세·전환, 돌파 후 리테스트 진입 구조 분석
 */
const VP_SHORT = 40;
const VP_LONG = 120;
const VP_LONG_STEP = 20;
const VP_BINS = 12;
const VA_PCT = 0.7;
const RETEST_LOOKBACK = 28;
const RETEST_BAND = 0.015;

/**
 * @param {unknown[]} candles
 * @param {number} endIdx
 * @param {number} lookback
 */
function volumeProfileAt(candles, endIdx, lookback) {
  const i = endIdx;
  const start = Math.max(0, i - lookback + 1);
  const slice = candles.slice(start, i + 1);
  if (slice.length < 15) return null;

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
  const totalVol = volByBin.reduce((a, b) => a + b, 0);
  if (totalVol <= 0) return null;

  let pocBin = 0;
  for (let b = 1; b < VP_BINS; b++) {
    if (volByBin[b] > volByBin[pocBin]) pocBin = b;
  }
  const binSize = (maxP - minP) / VP_BINS;
  const pocBottom = minP + pocBin * binSize;
  const pocTop = minP + (pocBin + 1) * binSize;
  const pocMid = (pocBottom + pocTop) / 2;

  let acc = volByBin[pocBin];
  let loBin = pocBin;
  let hiBin = pocBin;
  const target = totalVol * VA_PCT;
  while (acc < target && (loBin > 0 || hiBin < VP_BINS - 1)) {
    const down = loBin > 0 ? volByBin[loBin - 1] : -1;
    const up = hiBin < VP_BINS - 1 ? volByBin[hiBin + 1] : -1;
    if (down >= up && loBin > 0) {
      loBin--;
      acc += volByBin[loBin];
    } else if (hiBin < VP_BINS - 1) {
      hiBin++;
      acc += volByBin[hiBin];
    } else if (loBin > 0) {
      loBin--;
      acc += volByBin[loBin];
    } else break;
  }
  const val = minP + loBin * binSize;
  const vah = minP + (hiBin + 1) * binSize;

  return {
    pocBottom,
    pocTop,
    pocMid,
    val,
    vah,
    minP,
    maxP,
    pocBin,
  };
}

/**
 * 장기 구간 POC 궤적 — 빗각(기울기) 추정
 * @param {unknown[]} candles
 */
export function volumeProfileLongAngled(candles) {
  const n = candles.length;
  if (n < VP_LONG * 0.5) return null;

  /** @type {{ idx: number; poc: number }[]} */
  const series = [];
  for (let end = n - 1; end >= Math.max(20, n - VP_LONG); end -= VP_LONG_STEP) {
    const vp = volumeProfileAt(candles, end, Math.min(VP_LONG, end + 1));
    if (vp?.pocMid != null) series.push({ idx: end, poc: vp.pocMid });
  }
  if (series.length < 3) return null;

  series.reverse();
  const xMean = series.reduce((s, p) => s + p.idx, 0) / series.length;
  const yMean = series.reduce((s, p) => s + p.poc, 0) / series.length;
  let num = 0;
  let den = 0;
  for (const p of series) {
    num += (p.idx - xMean) * (p.poc - yMean);
    den += (p.idx - xMean) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const angledPoc = intercept + slope * (n - 1);
  const vpFull = volumeProfileAt(candles, n - 1, VP_LONG);

  return {
    ...vpFull,
    angledPoc,
    slopePerBar: slope,
    rising: slope > 0,
    pocSeries: series,
  };
}

/**
 * @param {unknown[]} candles
 * @param {number} wing
 */
function collectSwingPoints(candles, wing = 2) {
  /** @type {{ idx: number; price: number; kind: "high"|"low" }[]} */
  const out = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= wing; j++) {
      const h = Number(candles[i].high ?? candles[i].close);
      const l = Number(candles[i].low ?? candles[i].close);
      if (h < Number(candles[i - j].high ?? 0) || h < Number(candles[i + j].high ?? 0)) {
        isHigh = false;
      }
      if (l > Number(candles[i - j].low ?? Infinity) || l > Number(candles[i + j].low ?? Infinity)) {
        isLow = false;
      }
    }
    if (isHigh) out.push({ idx: i, price: Number(candles[i].high), kind: "high" });
    if (isLow) out.push({ idx: i, price: Number(candles[i].low), kind: "low" });
  }
  return out;
}

/**
 * @param {{ idx: number; price: number }[]} pts
 * @param {number} atIdx
 */
function lineValueAt(pts, atIdx) {
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (b.idx === a.idx) return b.price;
  const t = (atIdx - a.idx) / (b.idx - a.idx);
  return a.price + (b.price - a.price) * t;
}

/**
 * @param {unknown[]} candles
 */
export function analyzeTrendStructure(candles) {
  const n = candles.length;
  if (n < 30) return null;
  const swings = collectSwingPoints(candles, 2);
  const highs = swings.filter((s) => s.kind === "high").slice(-4);
  const lows = swings.filter((s) => s.kind === "low").slice(-4);

  let bias = "range";
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2].price;
    const h2 = highs[highs.length - 1].price;
    const l1 = lows[lows.length - 2].price;
    const l2 = lows[lows.length - 1].price;
    if (h2 > h1 && l2 > l1) bias = "up";
    else if (h2 < h1 && l2 < l1) bias = "down";
    else if (h2 > h1) bias = "up";
    else if (l2 < l1) bias = "down";
  }

  const closes = candles.map((c) => Number(c.close));
  const sma = (arr, p) => {
    const o = new Array(arr.length).fill(null);
    for (let i = p - 1; i < arr.length; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += arr[i - j];
      o[i] = s / p;
    }
    return o;
  };
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const i = n - 1;
  let maCrossBull = false;
  if (
    ma20[i] != null &&
    ma50[i] != null &&
    ma20[i - 1] != null &&
    ma50[i - 1] != null &&
    ma20[i] > ma50[i] &&
    ma20[i - 1] <= ma50[i - 1]
  ) {
    maCrossBull = true;
  }

  let reversalBull = false;
  let reversalBear = false;
  if (lows.length >= 3 && highs.length >= 2) {
    const lPrev = lows[lows.length - 3].price;
    const lMid = lows[lows.length - 2].price;
    const lLast = lows[lows.length - 1].price;
    if (lMid < lPrev && lLast > lMid && closes[i] > ma20[i]) reversalBull = true;
    const hPrev = highs[highs.length - 3]?.price;
    const hMid = highs[highs.length - 2]?.price;
    const hLast = highs[highs.length - 1]?.price;
    if (hPrev != null && hMid > hPrev && hLast < hMid) reversalBear = true;
  }

  const supportLine = lows.length >= 2 ? lineValueAt(lows, i) : null;
  const resistanceLine = highs.length >= 2 ? lineValueAt(highs, i) : null;

  /** @type {string[]} */
  const labels = [];
  if (bias === "up") labels.push("상승 추세(고점·저점 상승)");
  else if (bias === "down") labels.push("하락 추세");
  else labels.push("횡보·레인지");
  if (reversalBull) labels.push("저점 상승 전환");
  if (reversalBear) labels.push("고점 하락 전환");
  if (maCrossBull) labels.push("20·50일선 골든크로스");

  return {
    bias,
    reversalBull,
    reversalBear,
    maCrossBull,
    supportLine,
    resistanceLine,
    labels,
  };
}

/**
 * @param {unknown[]} candles
 * @param {{ pocTop: number; pocBottom: number; val?: number }} vp
 */
export function detectVpBreakoutRetest(candles, vp) {
  const n = candles.length;
  if (n < 25 || !vp) return { kind: "none", entryIdeal: false, labels: [] };

  const pocTop = vp.pocTop;
  const pocBottom = vp.pocBottom;
  const val = vp.val ?? vp.pocBottom;
  const closes = candles.map((c) => Number(c.close));
  const lows = candles.map((c) => Number(c.low ?? c.close));
  const entry = closes[n - 1];

  let breakIdx = -1;
  const scanStart = Math.max(1, n - RETEST_LOOKBACK);
  for (let j = scanStart; j < n; j++) {
    if (closes[j] > pocTop && closes[j - 1] <= pocTop) {
      breakIdx = j;
      break;
    }
  }

  if (breakIdx < 0) {
    if (entry > pocTop * 1.02) {
      return {
        kind: "extended",
        entryIdeal: false,
        retestLevel: pocTop,
        stopLevel: Math.max(val, pocBottom),
        labels: ["매물대 상단 위 추격 구간"],
      };
    }
    return { kind: "none", entryIdeal: false, labels: [] };
  }

  let minLowAfter = Infinity;
  for (let j = breakIdx; j < n; j++) {
    minLowAfter = Math.min(minLowAfter, lows[j]);
  }

  const held = minLowAfter >= pocTop * (1 - RETEST_BAND);
  const nearRetest =
    entry >= pocTop * (1 - RETEST_BAND) && entry <= pocTop * (1 + RETEST_BAND * 1.2);

  if (held && nearRetest) {
    return {
      kind: "breakout_retest",
      entryIdeal: true,
      retestLevel: pocTop,
      stopLevel: Math.max(val, pocTop * (1 - RETEST_BAND * 1.2)),
      labels: ["매물대 돌파 후 리테스트 지지"],
    };
  }

  if (held) {
    return {
      kind: "breakout_hold",
      entryIdeal: true,
      retestLevel: pocTop,
      stopLevel: Math.max(val, pocBottom),
      labels: ["돌파 후 매물대 상단 유지"],
    };
  }

  return {
    kind: "breakout_fail",
    entryIdeal: false,
    retestLevel: pocTop,
    stopLevel: val,
    labels: ["돌파 후 되밀림"],
  };
}

/**
 * @param {unknown[]} candles
 * @param {number} entryPrice
 */
export function analyzeTradeStructure(candles, entryPrice) {
  const entryPx = Number(entryPrice);
  const n = candles?.length ?? 0;
  if (n < 25) {
    return {
      vpShort: null,
      vpLong: null,
      trend: null,
      entrySetup: null,
      labels: [],
      entryIdeal: false,
      entryKind: "none",
    };
  }

  const vpShort = volumeProfileAt(candles, n - 1, VP_SHORT);
  const vpLong = volumeProfileLongAngled(candles);
  const trend = analyzeTrendStructure(candles);
  const entryRef = vpLong ?? vpShort;
  const entrySetup = entryRef
    ? detectVpBreakoutRetest(candles, entryRef)
    : { kind: "none", entryIdeal: false, labels: [] };

  /** @type {string[]} */
  const labels = [];
  if (vpShort) {
    labels.push(
      `단기 매물대 POC ${Math.round(vpShort.pocMid)} (VA상단 ${Math.round(vpShort.vah)})`,
    );
  }
  if (vpLong) {
    const slopePct =
      vpLong.slopePerBar != null && entryPx > 0
        ? ((vpLong.slopePerBar * 20) / entryPx) * 100
        : null;
    const slopeNote =
      slopePct != null
        ? vpLong.rising
          ? `장기 빗각 매물대 ↗ (${slopePct.toFixed(2)}%/20일)`
          : `장기 빗각 매물대 ↘ (${slopePct.toFixed(2)}%/20일)`
        : "장기 매물대";
    labels.push(
      `${slopeNote} POC ${Math.round(vpLong.angledPoc ?? vpLong.pocMid)} · VA ${Math.round(vpLong.val)}~${Math.round(vpLong.vah)}`,
    );
  }
  if (trend?.labels?.length) labels.push(...trend.labels);
  if (entrySetup.labels?.length) labels.push(...entrySetup.labels);

  let entryIdeal =
    entrySetup.entryIdeal ||
    (trend?.reversalBull && entrySetup.kind !== "breakout_fail") ||
    (trend?.bias === "up" && entrySetup.kind === "breakout_retest");

  return {
    vpShort,
    vpLong,
    trend,
    entrySetup,
    labels,
    entryIdeal,
    entryKind: entrySetup.kind,
    angledSupport: vpLong?.angledPoc ?? vpShort?.pocMid ?? null,
    trendSupport: trend?.supportLine ?? null,
    trendResistance: trend?.resistanceLine ?? null,
  };
}
