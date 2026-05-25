import { normalizeCandles } from "./candle-utils.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import { resolveDisplayName } from "./names-ko.js";
import { TIMEFRAME_MAP } from "./timeframes.js";

const BINANCE_API = "https://api.binance.com/api/v3";

export function isBinanceUsdtSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,20}-USDT$/.test(s);
}

export function yahooUsdtToBinancePair(symbol) {
  const s = String(symbol).trim().toUpperCase();
  if (!isBinanceUsdtSymbol(s)) return null;
  const base = s.slice(0, -5);
  return `${base}USDT`;
}

function displayName(symbol) {
  const sym = symbol.toUpperCase();
  if (isBinanceUsdtSymbol(sym)) return cryptoYahooUsdtDisplayName(sym);
  return resolveDisplayName(sym);
}

async function binanceJson(path) {
  const url = `${BINANCE_API}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Binance 응답 파싱 실패: ${path}`);
  }
  if (!res.ok) {
    const msg = data.msg ?? data.message ?? text?.slice(0, 120) ?? res.statusText;
    throw new Error(`Binance ${res.status}: ${msg}`);
  }
  return data;
}

/** @param {string} binancePair e.g. BTCUSDT */
export async function fetchBinance24hrTicker(binancePair) {
  return binanceJson(`/ticker/24hr?symbol=${encodeURIComponent(binancePair)}`);
}

/** 전 심볼 24시간 티커 (USDT 마켓 필터는 호출부에서) */
export async function fetchBinanceTicker24hAll() {
  return binanceJson("/ticker/24hr");
}

/**
 * 여러 USDT 현물 24시간 시세 (한 번의 요청)
 * @param {string[]} yahooStyle e.g. ["BTC-USDT","ETH-USDT"]
 */
export async function loadBinanceUsdtQuotesBatch(yahooSymbols) {
  const pairs = yahooSymbols
    .map((s) => yahooUsdtToBinancePair(s))
    .filter(Boolean);
  if (pairs.length === 0) return { quotes: {}, updatedAt: Date.now() };

  const encoded = encodeURIComponent(JSON.stringify(pairs));
  const rows = await binanceJson(`/ticker/24hr?symbols=${encoded}`);
  if (!Array.isArray(rows)) {
    throw new Error("Binance ticker 배치 응답 형식 오류");
  }

  const byPair = new Map(rows.map((r) => [String(r.symbol).toUpperCase(), r]));
  const quotes = {};
  for (const sym of yahooSymbols) {
    const up = sym.trim().toUpperCase();
    const pair = yahooUsdtToBinancePair(up);
    if (!pair) continue;
    const t = byPair.get(pair);
    if (!t) continue;
    const price = Number(t.lastPrice);
    const change = Number(t.priceChange);
    const changePercent = Number(t.priceChangePercent);
    quotes[up] = {
      symbol: up,
      name: displayName(up),
      price: Number.isFinite(price) ? price : undefined,
      change: Number.isFinite(change) ? change : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      currency: "USDT",
      marketState: "REGULAR",
    };
  }
  return { quotes, updatedAt: Date.now() };
}

/**
 * v8 스냅샷과 동일한 quote 형태 (loadChartQuoteSnapshot 용)
 * @param {string} yahooSymbol e.g. BTC-USDT
 */
export async function loadBinanceUsdtQuoteSnapshot(yahooSymbol) {
  const sym = yahooSymbol.trim().toUpperCase();
  const pair = yahooUsdtToBinancePair(sym);
  if (!pair) return null;
  try {
    const t = await fetchBinance24hrTicker(pair);
    const price = Number(t.lastPrice);
    const change = Number(t.priceChange);
    const changePercent = Number(t.priceChangePercent);
    return {
      symbol: sym,
      name: displayName(sym),
      price: Number.isFinite(price) ? price : undefined,
      change: Number.isFinite(change) ? change : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      currency: "USDT",
      marketState: "REGULAR",
    };
  } catch {
    return null;
  }
}

function binanceIntervalForTimeframe(tf) {
  const cfg = TIMEFRAME_MAP[tf] ?? TIMEFRAME_MAP["1d"];
  if (tf === "4h") return "4h";
  if (cfg.interval === "60m") return "1h";
  return cfg.interval;
}

function historyStartMs(tf) {
  const now = Date.now();
  const DAY = 86400000;
  switch (tf) {
    case "1m":
      return now - 7 * DAY;
    case "5m":
    case "15m":
      return now - 60 * DAY;
    case "1h":
    case "4h":
      return now - 729 * DAY;
    case "1d":
      return now - 50 * 365 * DAY;
    default:
      return now - 365 * DAY;
  }
}

/** 분봉·시간봉에 붙는 일봉 보조 — Yahoo scan 일봉과 비슷하게 약 2년 */
function dailyAttachStartMs() {
  return Date.now() - 730 * 86400000;
}

/**
 * @param {string} binancePair
 * @param {string} interval
 * @param {number} earliestMs
 */
async function fetchKlinesWindow(binancePair, interval, earliestMs) {
  /** @type {Array<[number,string,string,string,string,string,number,string,number,string,number,string]>} */
  const merged = [];
  let endTime = Date.now();
  const maxPages = 60;

  for (let p = 0; p < maxPages; p++) {
    const q = new URLSearchParams({
      symbol: binancePair,
      interval,
      limit: "1000",
      endTime: String(endTime),
    });
    const batch = await binanceJson(`/klines?${q}`);
    if (!Array.isArray(batch) || batch.length === 0) break;

    merged.unshift(...batch);
    const oldestOpen = batch[0][0];
    if (oldestOpen <= earliestMs) break;
    endTime = oldestOpen - 1;
    if (batch.length < 1000) break;
  }

  const seen = new Set();
  const out = [];
  for (const row of merged) {
    const t0 = row[0];
    if (seen.has(t0)) continue;
    seen.add(t0);
    out.push(row);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((row) => row[0] >= earliestMs);
}

function klinesToRaw(rows) {
  return rows.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]) || 0,
  }));
}

function computeDailyChange(candles, interval, meta) {
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close;

  if ((interval === "1d" || interval === "1wk") && candles.length >= 2) {
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

/**
 * 차트 + 시세 (Yahoo parseChartResult 와 동일 필드)
 * @param {string} yahooSymbol BASE-USDT
 * @param {keyof typeof TIMEFRAME_MAP} timeframe
 * @param {{ dailyAttach?: boolean }} [opts] 일봉만 요청해 MA용 일봉 붙일 때 (약 2년)
 */
export async function fetchBinanceUsdtChart(yahooSymbol, timeframe, opts = {}) {
  const sym = yahooSymbol.trim().toUpperCase();
  const pair = yahooUsdtToBinancePair(sym);
  if (!pair) throw new Error(`USDT 페어가 아닙니다: ${yahooSymbol}`);

  const cfg = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP["1d"];
  const displayInterval = cfg.displayInterval;
  const bInterval = binanceIntervalForTimeframe(timeframe);
  const earliestMs =
    opts.dailyAttach && timeframe === "1d"
      ? dailyAttachStartMs()
      : historyStartMs(timeframe);

  const [ticker, rawRows] = await Promise.all([
    fetchBinance24hrTicker(pair),
    fetchKlinesWindow(pair, bInterval, earliestMs),
  ]);

  const raw = klinesToRaw(rawRows);
  const yahooStyleInterval =
    timeframe === "4h" ? "4h" : cfg.interval === "60m" ? "60m" : cfg.interval;
  const aggregate = timeframe === "4h" ? 1 : cfg.aggregate ?? 1;

  const candles = normalizeCandles(raw, yahooStyleInterval, aggregate);

  const lastPrice = Number(ticker.lastPrice);
  const open24 = Number(ticker.openPrice);
  const meta = {
    symbol: sym,
    currency: "USDT",
    regularMarketPrice: Number.isFinite(lastPrice) ? lastPrice : undefined,
    chartPreviousClose: Number.isFinite(open24) ? open24 : undefined,
    previousClose: Number.isFinite(open24) ? open24 : undefined,
    marketState: "REGULAR",
  };

  const { price, change, changePercent } = computeDailyChange(
    candles,
    displayInterval,
    meta,
  );

  return {
    symbol: sym,
    currency: "USDT",
    interval: displayInterval,
    yahooInterval: yahooStyleInterval,
    candleCount: candles.length,
    candles,
    updatedAt: Date.now(),
    quote: {
      symbol: sym,
      name: displayName(sym),
      price,
      change,
      changePercent,
      currency: "USDT",
      marketState: "REGULAR",
    },
    stale: false,
  };
}
