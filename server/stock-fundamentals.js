/**
 * 재무 밸류에이션 — US: Yahoo quoteSummary(TradingView·야후), KR: Naver integration
 */
import {
  fetchKrNaverQuoteForSymbol,
  isKrQuoteSymbol,
  yahooSymbolToKrCode,
} from "./kr-naver-quote.js";
import { resolveDisplayName } from "./names-ko.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const CACHE_MS = 5 * 60_000;
const NAVER_INTEGRATION_URL = "https://m.stock.naver.com/api/stock";
const NAVER_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

/** @type {Map<string, { at: number; data: unknown }>} */
const cache = new Map();

/** @param {unknown} v */
function numField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/** @param {unknown} data */
function quoteSummaryFirstResult(data) {
  const root = /** @type {Record<string, unknown>} */ (data ?? {});
  if (root.finance && typeof root.finance === "object") {
    const fin = /** @type {Record<string, unknown>} */ (root.finance);
    if (fin.error) return null;
  }
  const qs = root.quoteSummary;
  if (!qs || typeof qs !== "object") return null;
  const results = /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (qs).result);
  if (!Array.isArray(results) || results.length === 0) return null;
  return /** @type {Record<string, unknown>} */ (results[0]);
}

/** @param {number | null} price @param {number | null} denom */
function safeRatio(price, denom) {
  if (price == null || denom == null || !Number.isFinite(price) || !Number.isFinite(denom)) {
    return null;
  }
  if (Math.abs(denom) < 1e-12) return null;
  return price / denom;
}

/** @param {unknown} raw */
function parseNaverRatioValue(raw) {
  const m = String(raw ?? "")
    .replace(/,/g, "")
    .match(/([+-]?[\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} raw */
function parseNaverMoneyValue(raw) {
  const s = String(raw ?? "")
    .replace(/,/g, "")
    .replace(/원$/u, "")
    .trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} raw */
function parseNaverPercentValue(raw) {
  const m = String(raw ?? "").match(/([+-]?[\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n / 100 : null;
}

/** @param {unknown} totalInfos */
function naverInfoMap(totalInfos) {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!Array.isArray(totalInfos)) return map;
  for (const row of totalInfos) {
    if (!row || typeof row !== "object") continue;
    const code = String(/** @type {{ code?: unknown }} */ (row).code ?? "").trim();
    const value = String(/** @type {{ value?: unknown }} */ (row).value ?? "").trim();
    if (code && value) map.set(code, value);
  }
  return map;
}

/** @param {string} symbol */
function normalizeKrYahooSymbol(symbol, code) {
  const u = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (/\.(KS|KQ)$/i.test(u)) return u;
  return `${code}.KS`;
}

/**
 * @param {string} symbol
 */
async function loadKrNaverFundamentals(symbol) {
  const code = yahooSymbolToKrCode(symbol);
  if (!code) {
    const err = new Error("올바르지 않은 심볼 형식입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const sym = normalizeKrYahooSymbol(symbol, code);
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [integrationRes, quote] = await Promise.all([
    fetch(`${NAVER_INTEGRATION_URL}/${code}/integration`, {
      headers: { "User-Agent": NAVER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    }),
    fetchKrNaverQuoteForSymbol(sym),
  ]);

  if (!integrationRes.ok) {
    const err = new Error("재무 데이터를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const body = await integrationRes.json();
  const infos = naverInfoMap(body.totalInfos);
  if (infos.size === 0) {
    const err = new Error("재무 데이터를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const name =
    (typeof body.stockName === "string" && body.stockName.trim()) ||
    quote?.name ||
    resolveDisplayName(sym);

  const price = quote?.price ?? null;
  const eps = parseNaverMoneyValue(infos.get("eps"));
  const forwardEps = parseNaverMoneyValue(infos.get("cnsEps"));
  const bps = parseNaverMoneyValue(infos.get("bps"));
  const per = parseNaverRatioValue(infos.get("per")) ?? safeRatio(price, eps);
  const forwardPer =
    parseNaverRatioValue(infos.get("cnsPer")) ?? safeRatio(price, forwardEps);
  const pbr = parseNaverRatioValue(infos.get("pbr")) ?? safeRatio(price, bps);
  const dividendYield = parseNaverPercentValue(infos.get("dividendYieldRatio"));

  const payload = {
    symbol: sym,
    name,
    currency: "KRW",
    market: "kr",
    price,
    eps,
    forwardEps,
    bps,
    per,
    forwardPer,
    pbr,
    marketCap: null,
    dividendYield,
    profitMargin: null,
    revenueGrowth: null,
    roe: null,
    source: "Naver Finance",
    sourceNote: "국내 PER·EPS·PBR — TradingView 국내 재무와 동일 출처 계열",
    updatedAt: Date.now(),
  };

  cache.set(sym, { at: Date.now(), data: payload });
  return payload;
}

/**
 * @param {string} symbol
 */
async function loadYahooFundamentals(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const enc = encodeURIComponent(sym);
  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
  ].join(",");
  const data = await queueYahooRequest(() =>
    yahooGet(`/v10/finance/quoteSummary/${enc}?modules=${modules}`),
  );

  const r0 = quoteSummaryFirstResult(data);
  if (!r0) {
    const err = new Error("재무 데이터를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const priceMod =
    r0.price && typeof r0.price === "object"
      ? /** @type {Record<string, unknown>} */ (r0.price)
      : {};
  const summary =
    r0.summaryDetail && typeof r0.summaryDetail === "object"
      ? /** @type {Record<string, unknown>} */ (r0.summaryDetail)
      : {};
  const stats =
    r0.defaultKeyStatistics && typeof r0.defaultKeyStatistics === "object"
      ? /** @type {Record<string, unknown>} */ (r0.defaultKeyStatistics)
      : {};
  const fin =
    r0.financialData && typeof r0.financialData === "object"
      ? /** @type {Record<string, unknown>} */ (r0.financialData)
      : {};

  const name =
    (typeof priceMod.longName === "string" && priceMod.longName.trim()) ||
    (typeof priceMod.shortName === "string" && priceMod.shortName.trim()) ||
    resolveDisplayName(sym);

  const currency =
    (typeof priceMod.currency === "string" && priceMod.currency.trim()) ||
    (typeof summary.currency === "string" && summary.currency.trim()) ||
    "USD";

  const price =
    numField(priceMod.regularMarketPrice) ??
    numField(summary.regularMarketPrice) ??
    numField(fin.currentPrice);

  const eps =
    numField(stats.trailingEps) ??
    numField(summary.trailingEps) ??
    numField(summary.epsTrailingTwelveMonths);

  const forwardEps =
    numField(stats.forwardEps) ?? numField(summary.epsForward);

  const bps = numField(stats.bookValue) ?? numField(summary.bookValue);

  const per =
    numField(summary.trailingPE) ??
    numField(stats.trailingPE) ??
    safeRatio(price, eps);

  const forwardPer =
    numField(summary.forwardPE) ??
    numField(stats.forwardPE) ??
    safeRatio(price, forwardEps);

  const pbr =
    numField(stats.priceToBook) ??
    numField(summary.priceToBook) ??
    safeRatio(price, bps);

  const marketCap = numField(summary.marketCap) ?? numField(priceMod.marketCap);
  const dividendYield =
    numField(summary.dividendYield) ?? numField(summary.trailingAnnualDividendYield);
  const profitMargin = numField(fin.profitMargins);
  const revenueGrowth = numField(fin.revenueGrowth);
  const roe = numField(fin.returnOnEquity);

  const payload = {
    symbol: sym,
    name,
    currency,
    market: "us",
    price,
    eps,
    forwardEps,
    bps,
    per,
    forwardPer,
    pbr,
    marketCap,
    dividendYield,
    profitMargin,
    revenueGrowth,
    roe,
    source: "Yahoo Finance",
    sourceNote: "TradingView 재무·차트와 동일 데이터 계열",
    updatedAt: Date.now(),
  };

  cache.set(sym, { at: Date.now(), data: payload });
  return payload;
}

/**
 * @param {string} symbol
 */
export async function loadStockFundamentals(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,20}$/.test(sym)) {
    const err = new Error("올바르지 않은 심볼 형식입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }
  if (/-USDT$/i.test(sym)) {
    const err = new Error("코인 종목은 재무 지표를 지원하지 않습니다.");
    err.code = "UNSUPPORTED";
    throw err;
  }

  if (isKrQuoteSymbol(sym)) {
    return loadKrNaverFundamentals(sym);
  }
  return loadYahooFundamentals(sym);
}
