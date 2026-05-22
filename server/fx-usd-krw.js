import { normalizeCandles } from "./candle-utils.js";
import {
  getKstParts,
  kst9amUtcSec,
  kst9amUtcWindow,
  resolveFxValuationDateKst,
} from "./kr-business-day.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const FX_SYMBOL = "KRW=X";
const CACHE_TTL_MS = 60_000;

/** @type {{ rate: number | null; at: number; valuationDate: string; asOfMs: number | null }} */
let cached = { rate: null, at: 0, valuationDate: "", asOfMs: null };

/**
 * @param {Array<{ time: number; close: number }>} candles
 * @param {number} targetSec
 */
function pickCloseNearest9am(candles, targetSec) {
  let bestPx = null;
  let bestDiff = Infinity;
  let bestMs = null;
  for (const c of candles) {
    const px = Number(c.close);
    if (!Number.isFinite(px) || px <= 0) continue;
    const tSec =
      c.time > 1e12 ? Math.floor(c.time / 1000) : Math.floor(Number(c.time));
    const diff = Math.abs(tSec - targetSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestPx = px;
      bestMs = tSec * 1000;
    }
  }
  if (bestPx == null || bestDiff > 45 * 60) return null;
  return { price: bestPx, asOfMs: bestMs };
}

/**
 * @param {number} period1
 * @param {number} period2
 */
async function fetchKrwX1mCloses(period1, period2) {
  return queueYahooRequest(async () => {
    const params = new URLSearchParams({
      period1: String(period1),
      period2: String(period2),
      interval: "1m",
      includePrePost: "false",
    });
    const url = `/v8/finance/chart/${encodeURIComponent(FX_SYMBOL)}?${params.toString()}`;
    const data = await yahooGet(url);
    const result = data.chart?.result?.[0];
    if (!result) return [];
    const timestamps = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const raw = timestamps.map((ts, i) => ({
      time: ts,
      open: q.open?.[i],
      high: q.high?.[i],
      low: q.low?.[i],
      close: q.close?.[i],
      volume: q.volume?.[i] ?? 0,
    }));
    const candles = normalizeCandles(raw, "1m", 1);
    return candles
      .filter((c) => Number.isFinite(c.close) && c.close > 0)
      .map((c) => ({ time: c.time, close: c.close }));
  });
}

/**
 * 당일(KST) — range 1d 1분봉에서 09:00 봉 선택
 */
async function fetchToday9amFrom1d() {
  return queueYahooRequest(async () => {
    const params = new URLSearchParams({
      range: "1d",
      interval: "1m",
      includePrePost: "false",
    });
    const url = `/v8/finance/chart/${encodeURIComponent(FX_SYMBOL)}?${params.toString()}`;
    const data = await yahooGet(url);
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const raw = timestamps.map((ts, i) => ({
      time: ts,
      close: q.close?.[i],
    }));
    const valuationDate = resolveFxValuationDateKst();
    const targetSec = kst9amUtcSec(valuationDate);
    return pickCloseNearest9am(
      raw.filter((c) => Number.isFinite(c.close) && c.close > 0),
      targetSec,
    );
  });
}

/**
 * @param {string} valuationDate YYYY-MM-DD KST
 */
async function fetchRateAtKst9am(valuationDate) {
  const todayKey = getKstParts().dateKey;
  if (valuationDate === todayKey) {
    const today = await fetchToday9amFrom1d();
    if (today) return today;
  }

  const { targetSec, period1, period2 } = kst9amUtcWindow(valuationDate);
  const candles = await fetchKrwX1mCloses(period1, period2);
  const hit = pickCloseNearest9am(candles, targetSec);
  if (hit) return hit;

  const daily = await queueYahooRequest(async () => {
    const params = new URLSearchParams({
      period1: String(period1 - 86400),
      period2: String(period2 + 86400),
      interval: "1d",
    });
    const url = `/v8/finance/chart/${encodeURIComponent(FX_SYMBOL)}?${params.toString()}`;
    const data = await yahooGet(url);
    return data.chart?.result?.[0] ?? null;
  });
  if (daily) {
    const ts = daily.timestamp ?? [];
    const closes = daily.indicators?.quote?.[0]?.close ?? [];
    const dayStart = kst9amUtcSec(valuationDate);
    const dayEnd = dayStart + 86400;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t >= dayStart && t < dayEnd) {
        const px = Number(closes[i]);
        if (Number.isFinite(px) && px > 0) {
          return { price: px, asOfMs: t * 1000 };
        }
      }
    }
  }

  return null;
}

/**
 * USD 1달러당 KRW — 기준: KST 영업일 09:00 (공휴·주말·09시 전이면 직전 영업일 09:00)
 * @returns {Promise<{
 *   rate: number;
 *   updatedAt: number;
 *   valuationDate: string;
 *   basis: string;
 *   asOfMs: number | null;
 * }>}
 */
export async function getUsdKrwRate() {
  const valuationDate = resolveFxValuationDateKst();
  const now = Date.now();
  if (
    cached.rate != null &&
    cached.valuationDate === valuationDate &&
    now - cached.at < CACHE_TTL_MS
  ) {
    return {
      rate: cached.rate,
      updatedAt: cached.at,
      valuationDate: cached.valuationDate,
      basis: "kst_9am",
      asOfMs: cached.asOfMs,
    };
  }

  const hit = await fetchRateAtKst9am(valuationDate);
  if (!hit?.price) {
    if (cached.rate != null && cached.valuationDate) {
      return {
        rate: cached.rate,
        updatedAt: cached.at,
        valuationDate: cached.valuationDate,
        basis: "kst_9am",
        asOfMs: cached.asOfMs,
      };
    }
    throw new Error("원/달러 환율(09:00 KST)을 가져올 수 없습니다.");
  }

  cached = {
    rate: hit.price,
    at: now,
    valuationDate,
    asOfMs: hit.asOfMs,
  };

  return {
    rate: hit.price,
    updatedAt: now,
    valuationDate,
    basis: "kst_9am",
    asOfMs: hit.asOfMs,
  };
}
