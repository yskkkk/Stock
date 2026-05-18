import { normalizeCandles } from "./candle-utils.js";
import {
  fetchBinanceUsdtChart,
  isBinanceUsdtSymbol,
  loadBinanceUsdtQuoteSnapshot,
} from "./binance-usdt.js";
import { chartNotFoundError } from "./errors.js";
import { resolveDisplayName } from "./names-ko.js";
import { TIMEFRAME_MAP } from "./timeframes.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { clearYahooSession, getYahooSession, yahooGet, YAHOO_UA } from "./yahoo.js";

const CACHE_FRESH_MS = 5 * 60_000;
const SCAN_CACHE_MS = 25 * 60_000;
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
  const cacheKey = `${sym}:1d`;

  const cached = readCache(cacheKey, { maxAgeMs: SCAN_CACHE_MS });
  if (cached) return cached.data;

  const inflightKey = `scan:${sym}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = queueYahooRequest(async () => {
    const data = await fetchYahooChart(sym, "1d", { scan: true });
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
    const fetched = await fetchBinanceUsdtChart(sym, "1d", {
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
    ? await fetchBinanceUsdtChart(sym, timeframe)
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

/**
 * 코인 목록 등 — 캔들 전체 없이 현재가·등락률만 (v8 차트, 소량 봉).
 * v7 /finance/quote 는 Unauthorized 로 막히는 환경이 많아 차트 API를 사용한다.
 */
export async function loadChartQuoteSnapshot(symbol) {
  const sym = symbol.toUpperCase();
  if (isBinanceUsdtSymbol(sym)) {
    return loadBinanceUsdtQuoteSnapshot(sym);
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
