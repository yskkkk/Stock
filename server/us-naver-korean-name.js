import { getKoreanStockName, hasHangul, registerKoreanName } from "./names-ko.js";
import { yahooGet } from "./yahoo.js";

const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const NULL_CACHE_MS = 60 * 60 * 1000;

/** @typedef {{ stockName?: string; symbolCode?: string; stockExchangeName?: string }} NaverUsBasicRow */

/** @type {Map<string, { at: number; data: NaverUsBasicRow | null }>} */
const basicCache = new Map();

/** @param {string} symbol */
export function normalizeUsTicker(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(KS|KQ)$/i, "")
    .replace(/^KR_/i, "");
}

/** @param {string | null | undefined} exchangeName */
export function naverExchangeToTradingViewPrefix(exchangeName) {
  const ex = String(exchangeName ?? "")
    .trim()
    .toUpperCase();
  if (!ex) return null;
  if (ex.includes("NASDAQ")) return "NASDAQ";
  if (ex.includes("NYSE") || ex.includes("NEW YORK")) return "NYSE";
  if (ex.includes("AMEX") || ex.includes("AMERICAN")) return "AMEX";
  return yahooExchangeCodeToTradingViewPrefix(ex);
}

/** Yahoo `price.exchange` 코드 → TradingView 접두사 */
export function yahooExchangeCodeToTradingViewPrefix(code) {
  const ex = String(code ?? "")
    .trim()
    .toUpperCase();
  if (!ex) return null;
  if (ex === "NMS" || ex === "NGM" || ex === "NCM" || ex.includes("NASDAQ")) {
    return "NASDAQ";
  }
  if (ex === "NYQ" || ex === "NYS" || ex.includes("NYSE") || ex.includes("NEW YORK")) {
    return "NYSE";
  }
  if (ex === "ASE" || ex === "AMX" || ex.includes("AMEX") || ex.includes("AMERICAN")) {
    return "AMEX";
  }
  return null;
}

/** @param {string} ticker */
function usTickerToYahooSymbol(ticker) {
  return normalizeUsTicker(ticker).replace(/\./g, "-");
}

/**
 * @param {string} ticker
 * @returns {Promise<string | null>}
 */
export async function fetchYahooUsExchangeName(ticker) {
  const ySym = usTickerToYahooSymbol(ticker);
  if (!ySym) return null;
  try {
    const data = await yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(ySym)}?modules=price`,
    );
    const exchange = data?.quoteSummary?.result?.[0]?.price?.exchange;
    return typeof exchange === "string" && exchange.trim()
      ? exchange.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} ticker
 * @param {string | null | undefined} exchangeName
 */
export function usTickerToTradingViewSymbol(ticker, exchangeName) {
  const sym = normalizeUsTicker(ticker).replace(/\./g, "-");
  if (!sym) return null;
  const prefix = naverExchangeToTradingViewPrefix(exchangeName) ?? "NASDAQ";
  return `${prefix}:${sym}`;
}

/**
 * @param {string} naverCode
 * @returns {Promise<NaverUsBasicRow | null>}
 */
async function fetchNaverUsBasicRaw(naverCode) {
  const code = String(naverCode ?? "").trim();
  if (!code) return null;
  try {
    const res = await fetch(
      `https://api.stock.naver.com/stock/${encodeURIComponent(code)}/basic`,
      {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code === "StockConflict") return null;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {string} symbol
 * @returns {Promise<NaverUsBasicRow | null>}
 */
async function fetchNaverUsBasic(symbol) {
  const sym = normalizeUsTicker(symbol);
  if (!sym) return null;

  const hit = basicCache.get(sym);
  if (hit) {
    const ttl = hit.data ? CACHE_MS : NULL_CACHE_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
  }

  for (const code of [sym, `${sym}.O`, `${sym}.N`]) {
    const data = await fetchNaverUsBasicRaw(code);
    if (data?.symbolCode || data?.stockName) {
      basicCache.set(sym, { at: Date.now(), data });
      return data;
    }
  }

  basicCache.set(sym, { at: Date.now(), data: null });
  return null;
}

/**
 * @param {string} symbol
 * @returns {Promise<{ nameKo: string | null; tvSymbol: string | null; exchange: string | null }>}
 */
export async function resolveUsStockDisplayMeta(symbol) {
  const sym = normalizeUsTicker(symbol);
  const basic = await fetchNaverUsBasic(sym);
  const mappedKo = getKoreanStockName(sym);
  const naverKo =
    basic?.stockName && hasHangul(basic.stockName) ? basic.stockName.trim() : null;
  const nameKo = mappedKo ?? naverKo;
  if (nameKo && !mappedKo) registerKoreanName(sym, nameKo);
  let exchange =
    typeof basic?.stockExchangeName === "string"
      ? basic.stockExchangeName.trim() || null
      : null;
  if (!exchange) {
    const yahooExchange = await fetchYahooUsExchangeName(sym);
    if (yahooExchange) exchange = yahooExchange;
  }
  const tvSymbol = usTickerToTradingViewSymbol(
    basic?.symbolCode ?? sym,
    exchange,
  );
  return { nameKo, tvSymbol, exchange };
}

/**
 * @param {string} symbol
 * @returns {Promise<string | null>}
 */
export async function resolveUsKoreanStockName(symbol) {
  const meta = await resolveUsStockDisplayMeta(symbol);
  return meta.nameKo;
}

/**
 * @param {string[]} symbols
 * @param {number} [concurrency]
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveUsKoreanStockNamesBatch(symbols, concurrency = 6) {
  const batch = await resolveUsStockDisplayMetaBatch(symbols, concurrency);
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [sym, meta] of batch) {
    if (meta.nameKo) out.set(sym, meta.nameKo);
  }
  return out;
}

/**
 * @param {string[]} symbols
 * @param {number} [concurrency]
 * @returns {Promise<Map<string, { nameKo: string | null; tvSymbol: string | null; exchange: string | null }>>}
 */
export async function resolveUsStockDisplayMetaBatch(symbols, concurrency = 6) {
  /** @type {Map<string, { nameKo: string | null; tvSymbol: string | null; exchange: string | null }>} */
  const out = new Map();
  const uniq = [
    ...new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map(normalizeUsTicker)
        .filter(Boolean),
    ),
  ];
  const limit = Math.max(1, Math.min(concurrency, 12));

  for (let i = 0; i < uniq.length; i += limit) {
    const chunk = uniq.slice(i, i + limit);
    await Promise.all(
      chunk.map(async (sym) => {
        out.set(sym, await resolveUsStockDisplayMeta(sym));
      }),
    );
  }
  return out;
}
