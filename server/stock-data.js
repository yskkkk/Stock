import { normalizeCandles } from "./candle-utils.js";
import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import {
  fetchBithumbKrwChart,
  loadBithumbKrwQuoteSnapshot,
} from "./bithumb-krw.js";
import { chartNotFoundError } from "./errors.js";
import { resolveDisplayName } from "./names-ko.js";
import { TIMEFRAME_MAP } from "./timeframes.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { clearYahooSession, getYahooSession, yahooGet, YAHOO_UA } from "./yahoo.js";

const CACHE_FRESH_MS = 5 * 60_000;
/** 스크리너·/technical — 1분봉 기준 분석 시 캐시가 길면 추천 시점과 현재가 괴리가 커짐 */
const SCAN_CANDLE_CACHE_MS = Math.max(
  30_000,
  Number(process.env.SCAN_CANDLE_CACHE_MS) || 120_000,
);
const LIVE_CACHE_MS = 8_000;
const CACHE_STALE_MS = 7 * 24 * 60 * 60_000;
/** 캔들 캐시 무한 증가 방지 — 장시간 가동 시 메모리·GC 악화 원인 제거 */
const MAX_CACHE_KEYS = 360;

const cache = new Map();
const inflight = new Map();

function pruneStockDataCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.savedAt > CACHE_STALE_MS) cache.delete(key);
  }
  if (cache.size <= MAX_CACHE_KEYS) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  const remove = cache.size - MAX_CACHE_KEYS;
  for (let i = 0; i < remove; i++) cache.delete(sorted[i][0]);
}

function getCacheEntry(key) {
  return cache.get(key) ?? null;
}

function setCacheEntry(key, data) {
  cache.set(key, { data, savedAt: Date.now() });
  pruneStockDataCache();
}

function readCache(key, { allowStale = false, maxAgeMs = CACHE_FRESH_MS } = {}) {
  const entry = getCacheEntry(key);
  if (!entry) return null;
  const age = Date.now() - entry.savedAt;
  if (age <= maxAgeMs) return { data: entry.data, stale: false };
  if (allowStale && age <= CACHE_STALE_MS) return { data: entry.data, stale: true };
  return null;
}

function computeDailyChange(candles, interval, meta) {
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close;

  if (isDailyChartInterval(interval) && candles.length >= 2) {
    const prevClose = candles.at(-2)?.close;
    if (price != null && prevClose != null && prevClose > 0) {
      const change = price - prevClose;
      return {
        price,
        change,
        changePercent: (change / prevClose) * 100,
      };
    }
  }

  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (price != null && prevClose != null && prevClose > 0) {
    const change = price - prevClose;
    return {
      price,
      change,
      changePercent: (change / prevClose) * 100,
    };
  }

  return { price, change: undefined, changePercent: undefined };
}

function isDailyChartInterval(interval) {
  return interval === "1d" || interval === "1wk";
}

/** 당일 거래량(주) — meta 우선, 일봉이면 마지막 봉 volume 폴백 */
function resolveDayVolume(meta, candles, displayInterval) {
  const rmv = Number(meta?.regularMarketVolume);
  if (Number.isFinite(rmv) && rmv > 0) return rmv;
  if (isDailyChartInterval(displayInterval)) {
    const v = Number(candles.at(-1)?.volume);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

/** 거래대금 ≈ 거래량 × 현재가 */
function computeTurnover(dayVolume, price) {
  const vol = Number(dayVolume);
  const p = Number(price);
  if (!Number.isFinite(vol) || vol <= 0 || !Number.isFinite(p) || p <= 0) {
    return undefined;
  }
  return vol * p;
}

/** 스크리너·기술 점수용 캔들 (일봉이 아닐 때는 TIMEFRAME_MAP 그대로) */
export const SCAN_CHART_TIMEFRAME = "1m";

function chartConfig(timeframe, { scan = false } = {}) {
  const base = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP["1d"];
  if (!scan || timeframe !== "1d") return base;
  return { ...base, range: "2y", days: undefined };
}

function buildChartUrl(symbol, cfg) {
  const base = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    includePrePost: "false",
    events: "div,splits",
  });

  if (cfg.range) {
    params.set("range", cfg.range);
  } else if (cfg.days) {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - cfg.days * 24 * 60 * 60;
    params.set("period1", String(period1));
    params.set("period2", String(period2));
  } else {
    params.set("range", "1y");
  }

  params.set("interval", cfg.interval);
  return `${base}?${params.toString()}`;
}

/** 목록용 시세만 — v7 quote API는 차단되는 경우가 많아 v8 차트 경량 호출 */
function buildQuoteSnapshotChartUrl(symbol) {
  const base = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    range: "5d",
    interval: "1d",
    includePrePost: "false",
    events: "div,splits",
  });
  return `${base}?${params.toString()}`;
}

function parseChartResult(symbol, result, displayInterval, yahooInterval, aggregate) {
  const meta = result.meta ?? {};
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

  const candles = normalizeCandles(raw, yahooInterval, aggregate ?? 1);
  const { price, change, changePercent } = computeDailyChange(
    candles,
    displayInterval,
    meta,
  );

  const lastCandle = candles.at(-1);
  const dh = meta.regularMarketDayHigh;
  const dl = meta.regularMarketDayLow;
  const ch = lastCandle?.high;
  const cl = lastCandle?.low;
  let dayHigh =
    typeof dh === "number" && Number.isFinite(dh) && dh > 0 ? dh : undefined;
  let dayLow =
    typeof dl === "number" && Number.isFinite(dl) && dl > 0 ? dl : undefined;
  if (dayHigh == null && typeof ch === "number" && Number.isFinite(ch) && ch > 0) {
    dayHigh = ch;
  }
  if (dayLow == null && typeof cl === "number" && Number.isFinite(cl) && cl > 0) {
    dayLow = cl;
  }

  const dayVolume = resolveDayVolume(meta, candles, displayInterval);
  const turnover = computeTurnover(dayVolume, price);

  return {
    symbol: meta.symbol ?? symbol,
    currency: meta.currency,
    interval: displayInterval,
    yahooInterval,
    candleCount: candles.length,
    candles,
    updatedAt: Date.now(),
    quote: {
      symbol: meta.symbol ?? symbol,
      name: resolveDisplayName(
        meta.symbol ?? symbol,
        meta.shortName,
        meta.longName,
      ),
      price,
      change,
      changePercent,
      currency: meta.currency,
      marketState: meta.marketState,
      dayHigh,
      dayLow,
      dayVolume,
      turnover,
    },
    stale: false,
  };
}

async function fetchYahooChart(symbol, timeframe, options = {}) {
  const cfg = chartConfig(timeframe, options);
  const url = buildChartUrl(symbol, cfg);
  const data = await yahooGet(url);
  if (data.chart?.error) {
    throw chartNotFoundError(
      symbol,
      data.chart.error.description ?? "Chart error",
    );
  }
  const result = data.chart?.result?.[0];
  if (!result) throw chartNotFoundError(symbol);
  return parseChartResult(
    symbol,
    result,
    cfg.displayInterval,
    cfg.interval,
    cfg.aggregate,
  );
}

export async function fetchScanCandles(symbol) {
  const sym = symbol.toUpperCase();
  const tf = SCAN_CHART_TIMEFRAME;
  const cacheKey = `${sym}:scan:${tf}`;

  const cached = readCache(cacheKey, { maxAgeMs: SCAN_CANDLE_CACHE_MS });
  if (cached) return cached.data;

  const inflightKey = `scan:${sym}:${tf}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = queueYahooRequest(async () => {
    const scanOpts = tf === "1d" ? { scan: true } : {};
    const data = await fetchYahooChart(sym, tf, scanOpts);
    setCacheEntry(cacheKey, data);
    return data;
  });

  inflight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    inflight.delete(inflightKey);
  }
}

async function loadDailyChart(sym) {
  const cacheKey = `${sym}:1d`;
  const cached = readCache(cacheKey, { allowStale: true });
  if (cached?.data?.candles?.length) return cached.data;

  if (isBinanceUsdtSymbol(sym)) {
    const fetched = await fetchBithumbKrwChart(sym, "1d", {
      dailyAttach: true,
    });
    setCacheEntry(cacheKey, fetched);
    return fetched;
  }

  const fetched = await queueYahooRequest(() =>
    fetchYahooChart(sym, "1d", { scan: true }),
  );
  setCacheEntry(cacheKey, fetched);
  return fetched;
}

async function attachDailyQuote(symbol, data) {
  const sym = symbol.toUpperCase();
  try {
    const daily = await loadDailyChart(sym);
    if (!daily?.candles?.length) return null;

    const d = computeDailyChange(daily.candles, "1d", daily.quote);
    if (d.changePercent != null) {
      data.quote.price = d.price ?? data.quote.price;
      data.quote.change = d.change;
      data.quote.changePercent = d.changePercent;
      data.quote.marketState = daily.quote.marketState ?? data.quote.marketState;
    }
    return daily;
  } catch {
    return null;
  }
}

async function fetchRemote(symbol, timeframe) {
  const sym = symbol.toUpperCase();
  const data = isBinanceUsdtSymbol(sym)
    ? await fetchBithumbKrwChart(sym, timeframe)
    : await queueYahooRequest(() => fetchYahooChart(symbol, timeframe));
  if (timeframe !== "1d") {
    const daily = await attachDailyQuote(symbol, data);
    if (daily?.candles?.length) {
      data.dailyCandles = daily.candles;
    }
  }
  return data;
}

export function queueRequest(task) {
  return queueYahooRequest(task);
}

export async function loadStock(symbol, timeframe, options = {}) {
  const tf = Object.prototype.hasOwnProperty.call(TIMEFRAME_MAP, timeframe)
    ? timeframe
    : "1d";
  const { live = false } = options;
  const sym = symbol.toUpperCase();
  /** v2: 일봉 요청이 range=max일 때 Yahoo가 월봉으로 다운샘플링하던 캐시 무효화 */
  const cacheKey = `${sym}:${tf}:v2`;
  const inflightKey = `${cacheKey}:${live ? "live" : "cached"}`;

  if (!live) {
    const fresh = readCache(cacheKey);
    if (fresh) return fresh.data;
  } else {
    const entry = getCacheEntry(cacheKey);
    if (entry && Date.now() - entry.savedAt <= LIVE_CACHE_MS) {
      return { ...entry.data, stale: false };
    }
  }

  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = (async () => {
    const stale = readCache(cacheKey, { allowStale: true });
    try {
      const data = await fetchRemote(sym, tf);
      setCacheEntry(cacheKey, data);
      return data;
    } catch {
      if (stale) return { ...stale.data, stale: true, updatedAt: Date.now() };
      throw new Error(`종목 데이터를 가져올 수 없습니다: ${sym}`);
    } finally {
      inflight.delete(inflightKey);
    }
  })();

  inflight.set(inflightKey, task);
  return task;
}

/** 목록·보유종목 실시간 시세 — 당일 1분봉(장전·장후 포함) */
function buildQuoteSnapshot1mChartUrl(symbol) {
  const base = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
  const params = new URLSearchParams({
    range: "1d",
    interval: "1m",
    includePrePost: "true",
    events: "div,splits",
  });
  return `${base}?${params.toString()}`;
}

function pickPositivePrice(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 장외·프리마켓 meta와 1분봉(프리/포스트 포함) 중 더 최신 가격을 선택.
 * @param {Record<string, unknown>} meta
 * @param {Array<{ time?: number; close?: number }>} candles
 */
function resolveSnapshotPriceFromChart(meta, candles) {
  const last = candles.at(-1);
  const lastBar = pickPositivePrice(last?.close);
  const barMs =
    last?.time != null && Number.isFinite(last.time) && last.time > 0
      ? Math.floor(last.time * 1000)
      : 0;

  const post = pickPositivePrice(meta.postMarketPrice);
  const postMs =
    typeof meta.postMarketTime === "number" && meta.postMarketTime > 0
      ? Math.floor(meta.postMarketTime * 1000)
      : 0;
  const pre = pickPositivePrice(meta.preMarketPrice);
  const preMs =
    typeof meta.preMarketTime === "number" && meta.preMarketTime > 0
      ? Math.floor(meta.preMarketTime * 1000)
      : 0;
  const regular = pickPositivePrice(meta.regularMarketPrice);

  if (lastBar != null && barMs > 0) {
    if (post != null && postMs > barMs) {
      return { price: post, quotedAtMs: postMs };
    }
    if (pre != null && preMs > barMs) {
      return { price: pre, quotedAtMs: preMs };
    }
    return { price: lastBar, quotedAtMs: barMs };
  }
  if (post != null) return { price: post, quotedAtMs: postMs || Date.now() };
  if (pre != null) return { price: pre, quotedAtMs: preMs || Date.now() };
  if (regular != null) return { price: regular, quotedAtMs: Date.now() };
  return { price: null, quotedAtMs: Date.now() };
}

function resolveSnapshotChangePercent(meta, price) {
  const ms = String(meta.marketState ?? "").toUpperCase();
  if (ms.includes("POST") && Number.isFinite(meta.postMarketChangePercent)) {
    return meta.postMarketChangePercent;
  }
  if (ms.includes("PRE") && Number.isFinite(meta.preMarketChangePercent)) {
    return meta.preMarketChangePercent;
  }
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (price != null && prevClose != null && prevClose > 0) {
    return ((price - prevClose) / prevClose) * 100;
  }
  return undefined;
}

/**
 * 스크리너·추천·보유종목용 — 최신 1분봉(장전·장후 포함) 종가·전일대비 등락률.
 */
export async function loadChartQuoteSnapshot1m(symbol) {
  const sym = symbol.toUpperCase();
  if (isBinanceUsdtSymbol(sym)) {
    return loadBithumbKrwQuoteSnapshot(sym);
  }
  return queueYahooRequest(async () => {
    const url = buildQuoteSnapshot1mChartUrl(sym);
    const data = await yahooGet(url);
    if (data.chart?.error) return null;
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const parsed = parseChartResult(sym, result, "1m", "1m", 1);
    const { price, quotedAtMs } = resolveSnapshotPriceFromChart(meta, parsed.candles);
    if (price == null || !Number.isFinite(price)) return parsed.quote ?? null;
    const changePercent = resolveSnapshotChangePercent(meta, price);
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    const change =
      price != null && prevClose != null && prevClose > 0
        ? price - prevClose
        : parsed.quote?.change;
    return {
      ...parsed.quote,
      price,
      change,
      changePercent: changePercent ?? parsed.quote?.changePercent,
      marketState: meta.marketState ?? parsed.quote?.marketState,
      quotedAtMs,
    };
  });
}

/**
 * 코인 목록 등 — 캔들 전체 없이 현재가·등락률만 (v8 차트, 일봉 경량).
 * v7 /finance/quote 는 Unauthorized 로 막히는 환경이 많아 차트 API를 사용한다.
 */
export async function loadChartQuoteSnapshot(symbol) {
  const sym = symbol.toUpperCase();
  if (isBinanceUsdtSymbol(sym)) {
    return loadBithumbKrwQuoteSnapshot(sym);
  }
  return queueYahooRequest(async () => {
    const url = buildQuoteSnapshotChartUrl(sym);
    const data = await yahooGet(url);
    if (data.chart?.error) return null;
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const parsed = parseChartResult(sym, result, "1d", "1d", 1);
    return parsed.quote;
  });
}

export { TIMEFRAME_MAP, getYahooSession, YAHOO_UA, normalizeCandles };
