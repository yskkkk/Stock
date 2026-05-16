import type { Candle, ChartTime } from "../types";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    out[i] = sum / period;
  }
  return out;
}

function midline(highs: number[], lows: number[], period: number) {
  const out: (number | null)[] = new Array(highs.length).fill(null);
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

export function ichimoku(highs: number[], lows: number[]) {
  const tenkan = midline(highs, lows, 9);
  const kijun = midline(highs, lows, 26);
  const spanB = midline(highs, lows, 52);
  const spanA = tenkan.map((t, i) =>
    t != null && kijun[i] != null ? (t + kijun[i]) / 2 : null,
  );
  return { tenkan, kijun, spanA, spanB };
}

export interface LinePoint {
  time: ChartTime;
  value: number;
}

export function lineFromValues(
  candles: Candle[],
  values: (number | null)[],
  timeOffset = 0,
): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v == null) continue;
    const tIdx = i + timeOffset;
    if (tIdx < 0 || tIdx >= candles.length) continue;
    out.push({ time: candles[tIdx].time, value: v });
  }
  return out;
}

const KST_OFFSET_SEC = 9 * 60 * 60;

function dailyKeyFromUnix(sec: number) {
  const kstMs = sec * 1000 + KST_OFFSET_SEC * 1000;
  const d = new Date(kstMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dailyKeyFromTime(t: ChartTime) {
  if (typeof t === "number") return dailyKeyFromUnix(t);
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

function buildDailyMaMaps(dailyCandles: Candle[]) {
  const closes = dailyCandles.map((c) => c.close);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const map20 = new Map<string, number>();
  const map50 = new Map<string, number>();
  for (let i = 0; i < dailyCandles.length; i++) {
    const key = dailyKeyFromTime(dailyCandles[i].time);
    const v20 = ma20[i];
    const v50 = ma50[i];
    if (v20 != null) map20.set(key, v20);
    if (v50 != null) map50.set(key, v50);
  }
  return { map20, map50 };
}

export function computeMaLines(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  return {
    ma20: lineFromValues(candles, sma(closes, 20)),
    ma50: lineFromValues(candles, sma(closes, 50)),
  };
}

/** 표시 타임프레임 캔들 위에 일봉 20·50일선 매핑 */
export function computeMaLinesFromDaily(
  displayCandles: Candle[],
  dailyCandles: Candle[],
) {
  if (dailyCandles.length === 0) return computeMaLines(displayCandles);

  const { map20, map50 } = buildDailyMaMaps(dailyCandles);
  const ma20: LinePoint[] = [];
  const ma50: LinePoint[] = [];
  let last20: number | null = null;
  let last50: number | null = null;

  for (const c of displayCandles) {
    const key = dailyKeyFromTime(c.time);
    if (map20.has(key)) last20 = map20.get(key)!;
    if (map50.has(key)) last50 = map50.get(key)!;
    if (last20 != null) ma20.push({ time: c.time, value: last20 });
    if (last50 != null) ma50.push({ time: c.time, value: last50 });
  }

  return { ma20, ma50 };
}

const ICHI_SHIFT = 26;

/** 선행스팬 등 LinePoint 정렬·병합용 (unix 초 또는 일봉 달력) */
function chartTimeOrderKey(t: ChartTime): number {
  if (typeof t === "number") return t;
  return Date.UTC(t.year, t.month - 1, t.day) / 1000;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
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

export function computeRsiLine(candles: Candle[], period = 14) {
  const closes = candles.map((c) => c.close);
  return lineFromValues(candles, rsi(closes, period));
}

export function computeIchimokuLines(candles: Candle[]) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const ichi = ichimoku(highs, lows);
  return {
    tenkan: lineFromValues(candles, ichi.tenkan),
    kijun: lineFromValues(candles, ichi.kijun),
    spanA: lineFromValues(candles, ichi.spanA, ICHI_SHIFT),
    spanB: lineFromValues(candles, ichi.spanB, ICHI_SHIFT),
  };
}

/** 선행스팬 A·B 구름(양운 A≥B, 음운 B>A) — 캔들 몸통으로 채움 */
export function buildIchimokuCloudBarsFromSpans(
  spanA: LinePoint[],
  spanB: LinePoint[],
): Candle[] {
  /** spanA·B는 null 스킵으로 배열 인덱스가 시각과 일치하지 않음 → 시각으로 병합 */
  const byTimeA = new Map<number, { time: ChartTime; value: number }>();
  for (const p of spanA) {
    byTimeA.set(chartTimeOrderKey(p.time), { time: p.time, value: p.value });
  }
  const byTimeB = new Map<number, number>();
  for (const p of spanB) {
    byTimeB.set(chartTimeOrderKey(p.time), p.value);
  }

  const keys = [...byTimeA.keys()]
    .filter((k) => byTimeB.has(k))
    .sort((x, y) => x - y);

  const out: Candle[] = [];
  for (const k of keys) {
    const cell = byTimeA.get(k);
    if (!cell) continue;
    const { time, value: a } = cell;
    const b = byTimeB.get(k);
    if (b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;

    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    /** A==B 구간도 구멍 없이 채움 (극미 스프레드) */
    if (!(hi > lo)) {
      const mid = lo;
      const spread = Math.max(1e-8, Math.abs(mid) * 1e-10);
      lo = mid - spread / 2;
      hi = mid + spread / 2;
    }

    if (a >= b) {
      out.push({
        time,
        open: lo,
        high: hi,
        low: lo,
        close: hi,
        volume: 0,
      });
    } else {
      out.push({
        time,
        open: hi,
        high: hi,
        low: lo,
        close: lo,
        volume: 0,
      });
    }
  }
  return out;
}

export function computeIchimokuCloudBars(candles: Candle[]) {
  const { spanA, spanB } = computeIchimokuLines(candles);
  return buildIchimokuCloudBarsFromSpans(spanA, spanB);
}
