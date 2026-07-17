import { normalizeCandles } from "./candle-utils.js";
import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import {
  fetchBithumbKrwChart,
  loadBithumbKrwQuoteSnapshot,
} from "./bithumb-krw.js";
import { chartNotFoundError, isSymbolNotFound } from "./errors.js";
import { resolveDisplayName } from "./names-ko.js";
import { TIMEFRAME_MAP } from "./timeframes.js";
import {
  fetchKrNaverQuoteForSymbol,
  isKrQuoteSymbol,
  krNaverQuotesEnabled,
  naverQuoteToSnapshot,
} from "./kr-naver-quote.js";
import {
  queueYahooRequest,
  waitForYahooQueueReady,
} from "./yahoo-queue.js";
import { clearYahooSession, getYahooSession, yahooGet, YAHOO_UA } from "./yahoo.js";

const CACHE_FRESH_MS = 5 * 60_000;
/** 스크리너·/technical — 1분봉 기준 분석 시 캐시가 길면 추천 시점과 현재가 괴리가 커짐 */
const SCAN_CANDLE_CACHE_MS = Math.max(
  30_000,
  Number(process.env.SCAN_CANDLE_CACHE_MS) || 120_000,
);
const LIVE_CACHE_MS = 8_000;
/** rate-limit·일시 네트워크 오류까지 포함 — cool-down 대기 후 재시도 */
const YAHOO_FETCH_MAX_ATTEMPTS = (() => {
  const n = Number(process.env.YAHOO_FETCH_MAX_ATTEMPTS ?? 8);
  return Number.isFinite(n) && n >= 2 ? Math.min(n, 16) : 8;
})();

/** 종목보관 intraday 재검증 — 5분 캐시·2y 일봉(가벼운 Yahoo 요청) */
export const VAULT_RESCAN_LOAD_OPTS = { live: false, scan: true };

/** @type {{ maxAgeMs: number; maxKeys: number } | null} */
let activeScanSession = null;

/**
 * 대량 스캔 세션 — 캐시 TTL·상한 확장 (웹 live 캐시와 분리)
 * @param {{ maxAgeMs?: number; maxKeys?: number }} [sessionOpts]
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function runStockDataScanSession(sessionOpts, fn) {
  const prev = activeScanSession;
  activeScanSession = {
    maxAgeMs: Math.max(
      60_000,
      Number(sessionOpts?.maxAgeMs ?? process.env.STOCK_SCAN_SESSION_CACHE_MS) || 900_000,
    ),
    maxKeys: Math.max(
      360,
      Number(sessionOpts?.maxKeys ?? process.env.STOCK_SCAN_SESSION_MAX_KEYS) || 8000,
    ),
  };
  try {
    return await fn();
  } finally {
    activeScanSession = prev;
  }
}

export function isStockDataScanSessionActive() {
  return activeScanSession != null;
}

/** @param {object} [options] */
export function resolveBulkScanLoadOpts(options = {}) {
  if (options.scanSession === false) return options;
  if (activeScanSession || options.scanSession) {
    return { live: false, scan: true, ...options, scanSession: true };
  }
  return options;
}

const CACHE_STALE_MS = 7 * 24 * 60 * 60_000;
/** 캔들 캐시 무한 증가 방지 — 장시간 가동 시 메모리·GC 악화 원인 제거 */
const MAX_CACHE_KEYS = 360;

const cache = new Map();
const inflight = new Map();

function scanSessionMaxKeys() {
  return activeScanSession?.maxKeys ?? MAX_CACHE_KEYS;
}

function pruneStockDataCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.savedAt > CACHE_STALE_MS) cache.delete(key);
  }
  const cap = scanSessionMaxKeys();
  if (cache.size <= cap) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  const remove = cache.size - cap;
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

function chartConfig(timeframe, { scan = false, boxRangeScan = false } = {}) {
  const base = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP["1d"];
  if (boxRangeScan) {
    if (timeframe === "1d") {
      return { ...base, range: "50y", days: undefined };
    }
    if (timeframe === "1h" || timeframe === "4h") {
      const envDays = Number(process.env.STOCK_BOX_RANGE_SCAN_DAYS ?? 729);
      const days =
        Number.isFinite(envDays) && envDays >= 30
          ? Math.min(729, Math.floor(envDays))
          : 729;
      return { ...base, days, range: undefined, aggregate: base.aggregate };
    }
  }
  if (!scan || (timeframe !== "1d" && timeframe !== "1wk")) return base;
  if (timeframe === "1wk") {
    return { ...base, range: "50y", days: undefined };
  }
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
  const adjCloseArr = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const raw = timestamps.map((ts, i) => {
    const rawClose = q.close?.[i];
    const adjClose = adjCloseArr[i];
    // 분할 조정 비율 적용 — adjclose가 있을 때 OHLC 전체를 동일 비율로 스케일
    const ratio =
      typeof adjClose === "number" &&
      Number.isFinite(adjClose) &&
      typeof rawClose === "number" &&
      Number.isFinite(rawClose) &&
      rawClose > 0
        ? adjClose / rawClose
        : 1;
    return {
      time: ts,
      open:  typeof q.open?.[i]  === "number" ? q.open[i]  * ratio : q.open?.[i],
      high:  typeof q.high?.[i]  === "number" ? q.high[i]  * ratio : q.high?.[i],
      low:   typeof q.low?.[i]   === "number" ? q.low[i]   * ratio : q.low?.[i],
      close: typeof rawClose     === "number" ? rawClose    * ratio : rawClose,
      volume: q.volume?.[i] ?? 0,
    };
  });

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
  const cacheKey = isBinanceUsdtSymbol(sym)
    ? `${sym}:scan:bithumb:${tf}`
    : `${sym}:scan:${tf}`;

  const cached = readCache(cacheKey, { maxAgeMs: SCAN_CANDLE_CACHE_MS });
  if (cached) return cached.data;

  const inflightKey = `scan:${sym}:${tf}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const task = isBinanceUsdtSymbol(sym)
    ? (async () => {
        const data = await fetchBithumbKrwChart(sym, tf);
        setCacheEntry(cacheKey, data);
        return data;
      })()
    : queueYahooRequest(async () => {
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

async function fetchRemote(symbol, timeframe, loadOpts = {}) {
  const sym = symbol.toUpperCase();
  const data = isBinanceUsdtSymbol(sym)
    ? await fetchBithumbKrwChart(sym, timeframe)
    : await queueYahooRequest(() => fetchYahooChart(symbol, timeframe, loadOpts));
  if (timeframe !== "1d") {
    const daily = await attachDailyQuote(symbol, data);
    if (daily?.candles?.length) {
      data.dailyCandles = daily.candles;
    }
  }
  return data;
}

/**
 * Yahoo/네트워크 일시 오류 — rate limit·연결 끊김·세션·타임아웃 등.
 * @param {unknown} err
 */
function isTransientYahooError(err) {
  if (!err) return false;
  const code =
    typeof err === "object" && err && "code" in err
      ? String(/** @type {{ code?: unknown }} */ (err).code)
      : "";
  if (code === "RATE_LIMIT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ABORT_ERR") {
    return true;
  }
  const name =
    err instanceof Error
      ? err.name
      : typeof err === "object" && err && "name" in err
        ? String(/** @type {{ name?: unknown }} */ (err).name)
        : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const msg = (
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String(/** @type {{ message?: unknown }} */ (err).message)
        : String(err)
  ).toLowerCase();
  return /rate|too many|fetch failed|network|econnreset|econnrefused|etimedout|socket|yahoo session|aborted|timeout|503|502|504|und_err/.test(
    msg,
  );
}

/**
 * @param {unknown} err
 */
function errorCodeOf(err) {
  if (err && typeof err === "object" && "code" in err) {
    return String(/** @type {{ code?: unknown }} */ (err).code ?? "");
  }
  return "";
}

async function fetchRemoteWithRetry(symbol, timeframe, loadOpts = {}) {
  let lastErr;
  let clearedSession = false;
  for (let attempt = 0; attempt < YAHOO_FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchRemote(symbol, timeframe, loadOpts);
    } catch (err) {
      lastErr = err;
      if (!isTransientYahooError(err) || attempt + 1 >= YAHOO_FETCH_MAX_ATTEMPTS) {
        throw err;
      }
      const code = errorCodeOf(err);
      // crumb/세션이 꼬인 채 반복 429 되는 경우 — 한 번 세션 갱신
      if (
        (code === "RATE_LIMIT" || /yahoo session/i.test(String(err?.message ?? ""))) &&
        !clearedSession &&
        attempt >= 1
      ) {
        clearYahooSession();
        clearedSession = true;
      }
      // cool-down 이 끝날 때까지 기다린 뒤 짧은 지터 — 이전처럼 1.5s만 자고 재시도하지 않음
      await waitForYahooQueueReady({
        minWaitMs: 600 * (attempt + 1),
        jitterMs: 400,
      });
    }
  }
  throw lastErr;
}

export function queueRequest(task) {
  return queueYahooRequest(task);
}

export async function loadStock(symbol, timeframe, options = {}) {
  const tf = Object.prototype.hasOwnProperty.call(TIMEFRAME_MAP, timeframe)
    ? timeframe
    : "1d";
  const opts = resolveBulkScanLoadOpts(options);
  const live = opts.live === true;
  const sym = symbol.toUpperCase();
  /** v2: 일봉 요청이 range=max일 때 Yahoo가 월봉으로 다운샘플링하던 캐시 무효화 */
  const cacheKey = `${sym}:${tf}:v3`;
  const inflightKey = `${cacheKey}:${live ? "live" : "cached"}`;

  const sessionMaxAge = activeScanSession?.maxAgeMs;
  if (!live) {
    const fresh = readCache(cacheKey, {
      maxAgeMs: sessionMaxAge ?? CACHE_FRESH_MS,
    });
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
      const data = await fetchRemoteWithRetry(sym, tf, opts);
      setCacheEntry(cacheKey, data);
      return data;
    } catch (err) {
      if (stale) return { ...stale.data, stale: true, updatedAt: Date.now() };
      if (isSymbolNotFound(err)) throw err;
      const detail =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "code" in err
            ? String(/** @type {{ code?: unknown }} */ (err).code)
            : String(err);
      const lower = detail.toLowerCase();
      if (/no data found|delisted|not found|chart error/.test(lower)) {
        throw chartNotFoundError(sym, detail);
      }
      const wrapped = new Error(`종목 데이터를 가져올 수 없습니다: ${sym} (${detail})`);
      const code = errorCodeOf(err);
      if (code) {
        /** @type {{ code?: string; retryAfterMs?: number }} */ (wrapped).code = code;
      }
      if (
        err &&
        typeof err === "object" &&
        "retryAfterMs" in err &&
        typeof /** @type {{ retryAfterMs?: unknown }} */ (err).retryAfterMs === "number"
      ) {
        /** @type {{ retryAfterMs?: number }} */ (wrapped).retryAfterMs =
          /** @type {{ retryAfterMs: number }} */ (err).retryAfterMs;
      }
      throw wrapped;
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
function metaTimeToMs(t) {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return 0;
  return t > 1e12 ? Math.floor(t) : Math.floor(t * 1000);
}

function resolveSnapshotPriceFromChart(meta, candles) {
  const last = candles.at(-1);
  const lastBar = pickPositivePrice(last?.close);
  const barMs =
    last?.time != null && Number.isFinite(last.time) && last.time > 0
      ? Math.floor(last.time * 1000)
      : 0;

  /** @type {{ price: number; quotedAtMs: number; kind: string }[]} */
  const candidates = [];
  if (lastBar != null && barMs > 0) {
    candidates.push({ price: lastBar, quotedAtMs: barMs, kind: "1m" });
  }
  const post = pickPositivePrice(meta.postMarketPrice);
  const postMs = metaTimeToMs(meta.postMarketTime);
  if (post != null) {
    candidates.push({
      price: post,
      quotedAtMs: postMs || Date.now(),
      kind: "post",
    });
  }
  const pre = pickPositivePrice(meta.preMarketPrice);
  const preMs = metaTimeToMs(meta.preMarketTime);
  if (pre != null) {
    candidates.push({
      price: pre,
      quotedAtMs: preMs || Date.now(),
      kind: "pre",
    });
  }
  const regular = pickPositivePrice(meta.regularMarketPrice);
  const regularMs = metaTimeToMs(meta.regularMarketTime);
  if (regular != null) {
    candidates.push({
      price: regular,
      quotedAtMs: regularMs || Date.now(),
      kind: "regular",
    });
  }

  if (candidates.length === 0) {
    return { price: null, quotedAtMs: Date.now(), priceSource: null };
  }
  candidates.sort((a, b) => b.quotedAtMs - a.quotedAtMs);
  const best = candidates[0];
  return {
    price: best.price,
    quotedAtMs: best.quotedAtMs,
    priceSource: best.kind === "1m" ? "1m" : best.kind,
  };
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
  if (isKrQuoteSymbol(sym) && krNaverQuotesEnabled()) {
    const kr = await fetchKrNaverQuoteForSymbol(sym);
    if (kr) return naverQuoteToSnapshot(kr);
  }
  return queueYahooRequest(async () => {
    const url = buildQuoteSnapshot1mChartUrl(sym);
    const data = await yahooGet(url);
    if (data.chart?.error) return null;
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const parsed = parseChartResult(sym, result, "1m", "1m", 1);
    const { price, quotedAtMs, priceSource } = resolveSnapshotPriceFromChart(
      meta,
      parsed.candles,
    );
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
      priceSource: priceSource ?? "1m",
      interval: priceSource ?? "1m",
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
