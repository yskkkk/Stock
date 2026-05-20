import { normalizeCandles } from "./candle-utils.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import { TIMEFRAME_MAP } from "./timeframes.js";

const BITHUMB_API = "https://api.bithumb.com/public";

/** @type {{ data: Record<string, Record<string, string>> | null; at: number }} */
let allTickerCache = { data: null, at: 0 };
const ALL_TICKER_CACHE_MS = 2_500;

export { isBinanceUsdtSymbol as isCryptoUsdtSymbol };

/** @param {string} symbol e.g. BTC-USDT */
export function usdtSymbolToBithumbBase(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (!isBinanceUsdtSymbol(s)) return null;
  return s.slice(0, -5);
}

function displayName(symbol) {
  const sym = symbol.toUpperCase();
  if (isBinanceUsdtSymbol(sym)) return cryptoYahooUsdtDisplayName(sym);
  return sym;
}

async function bithumbPublic(path) {
  const url = `${BITHUMB_API}${path}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  /** @type {{ status?: string; data?: unknown; message?: string }} */
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Bithumb 응답 파싱 실패: ${path}`);
  }
  if (!res.ok) {
    const msg = body.message ?? text?.slice(0, 120) ?? res.statusText;
    throw new Error(`Bithumb HTTP ${res.status}: ${msg}`);
  }
  if (String(body.status ?? "") !== "0000") {
    throw new Error(`Bithumb API ${body.status ?? "?"}: ${body.message ?? path}`);
  }
  return body.data;
}

/**
 * KRW 마켓 전 종목 24h 티커 (짧은 메모리 캐시)
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
export async function fetchBithumbAllKrwTickers() {
  const now = Date.now();
  if (allTickerCache.data && now - allTickerCache.at < ALL_TICKER_CACHE_MS) {
    return allTickerCache.data;
  }
  const data = await bithumbPublic("/ticker/ALL_KRW");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Bithumb ALL_KRW 응답 형식 오류");
  }
  /** @type {Record<string, Record<string, string>>} */
  const map = /** @type {Record<string, Record<string, string>>} */ (data);
  allTickerCache = { data: map, at: now };
  return map;
}

/**
 * @param {string} base e.g. BTC
 */
export async function fetchBithumbKrwTicker(base) {
  const data = await bithumbPublic(`/ticker/${encodeURIComponent(base)}_KRW`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Bithumb ticker 형식 오류: ${base}`);
  }
  return /** @type {Record<string, string>} */ (data);
}

/**
 * @param {string} pair e.g. BTC_KRW
 * @param {string} interval 1m|3m|5m|10m|30m|1h|6h|12h|24h
 */
async function fetchBithumbCandlestick(pair, interval) {
  const rows = await bithumbPublic(
    `/candlestick/${encodeURIComponent(pair)}/${encodeURIComponent(interval)}`,
  );
  if (!Array.isArray(rows)) {
    throw new Error(`Bithumb candlestick 형식 오류: ${pair}`);
  }
  return rows;
}

/** Bithumb: [ms, open, close, high, low, volume] */
function bithumbRowsToRaw(rows) {
  return rows.map((row) => {
    const t = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[2]);
    const high = Number(row[3]);
    const low = Number(row[4]);
    const volume = Number(row[5]) || 0;
    return {
      time: Math.floor(t / 1000),
      open,
      high,
      low,
      close,
      volume,
    };
  });
}

function quoteFromBithumbTicker(sym, ticker) {
  const price = Number(ticker.closing_price);
  const change = Number(ticker.fluctate_24H);
  const changePercent = Number(ticker.fluctate_rate_24H);
  const prev = Number(ticker.prev_closing_price);
  const turnover = bithumbTickerTurnoverKrw(ticker);
  return {
    symbol: sym,
    name: displayName(sym),
    price: Number.isFinite(price) ? price : undefined,
    change: Number.isFinite(change) ? change : undefined,
    changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
    currency: "KRW",
    turnover: turnover > 0 ? turnover : undefined,
    marketState: "REGULAR",
    chartPreviousClose: Number.isFinite(prev) ? prev : undefined,
    previousClose: Number.isFinite(prev) ? prev : undefined,
    regularMarketPrice: Number.isFinite(price) ? price : undefined,
  };
}

/**
 * @param {string[]} yahooSymbols e.g. ["BTC-USDT"]
 */
export async function loadBithumbKrwQuotesBatch(yahooSymbols) {
  const all = await fetchBithumbAllKrwTickers();
  const quotes = {};
  for (const sym of yahooSymbols) {
    const up = sym.trim().toUpperCase();
    const base = usdtSymbolToBithumbBase(up);
    if (!base) continue;
    const t = all[base];
    if (!t) continue;
    quotes[up] = quoteFromBithumbTicker(up, t);
  }
  return { quotes, updatedAt: Date.now() };
}

/** @param {string} yahooSymbol */
export async function loadBithumbKrwQuoteSnapshot(yahooSymbol) {
  const sym = yahooSymbol.trim().toUpperCase();
  const base = usdtSymbolToBithumbBase(sym);
  if (!base) return null;
  try {
    const t = await fetchBithumbKrwTicker(base);
    return quoteFromBithumbTicker(sym, t);
  } catch {
    try {
      const all = await fetchBithumbAllKrwTickers();
      const t = all[base];
      if (!t) return null;
      return quoteFromBithumbTicker(sym, t);
    } catch {
      return null;
    }
  }
}

function bithumbIntervalForTimeframe(tf) {
  switch (tf) {
    case "1m":
      return "1m";
    case "5m":
      return "5m";
    case "15m":
      return "10m";
    case "1h":
      return "1h";
    case "4h":
      return "1h";
    case "1d":
      return "24h";
    default:
      return "24h";
  }
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
 * 차트 + 시세 (앱 BTC-USDT 키 유지, 가격·봉은 빗썸 KRW)
 * @param {string} yahooSymbol
 * @param {keyof typeof TIMEFRAME_MAP} timeframe
 * @param {{ dailyAttach?: boolean }} [opts]
 */
export async function fetchBithumbKrwChart(yahooSymbol, timeframe, opts = {}) {
  const sym = yahooSymbol.trim().toUpperCase();
  const base = usdtSymbolToBithumbBase(sym);
  if (!base) throw new Error(`KRW 페어가 아닙니다: ${yahooSymbol}`);

  const cfg = TIMEFRAME_MAP[timeframe] ?? TIMEFRAME_MAP["1d"];
  const displayInterval = cfg.displayInterval;
  const bInterval =
    opts.dailyAttach && timeframe === "1d"
      ? "24h"
      : bithumbIntervalForTimeframe(timeframe);

  const pair = `${base}_KRW`;
  const [ticker, rawRows] = await Promise.all([
    fetchBithumbKrwTicker(base),
    fetchBithumbCandlestick(pair, bInterval),
  ]);

  const raw = bithumbRowsToRaw(rawRows);
  const yahooStyleInterval =
    timeframe === "4h" ? "4h" : cfg.interval === "60m" ? "60m" : cfg.interval;
  const aggregate = timeframe === "4h" ? 4 : cfg.aggregate ?? 1;

  const candles = normalizeCandles(raw, yahooStyleInterval, aggregate);
  const q = quoteFromBithumbTicker(sym, ticker);
  const meta = {
    symbol: sym,
    currency: "KRW",
    regularMarketPrice: q.regularMarketPrice,
    chartPreviousClose: q.chartPreviousClose,
    previousClose: q.previousClose,
    marketState: "REGULAR",
  };

  const { price, change, changePercent } = computeDailyChange(
    candles,
    displayInterval,
    meta,
  );

  return {
    symbol: sym,
    currency: "KRW",
    interval: displayInterval,
    yahooInterval: yahooStyleInterval,
    candleCount: candles.length,
    candles,
    updatedAt: Date.now(),
    quote: {
      ...q,
      price,
      change,
      changePercent,
    },
    stale: false,
  };
}

/** 24h 거래대금(KRW) — acc_trade_value_24H (코인 수량 units_traded 아님) */
export function bithumbTickerTurnoverKrw(ticker) {
  const v = Number(ticker?.acc_trade_value_24H ?? ticker?.acc_trade_value);
  return Number.isFinite(v) ? v : 0;
}

/** @deprecated 거래대금 — 이름만 volume */
export const bithumbTickerQuoteVolumeKrw = bithumbTickerTurnoverKrw;
