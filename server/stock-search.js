import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  englishYahooName,
  getKoreanStockName,
  hasHangul,
  resolveDisplayName,
} from "./names-ko.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { yahooGet } from "./yahoo.js";
import {
  isPrimaryUsSearchSymbol,
  isUsSearchResultRow,
} from "./stock-search-us-symbol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE_MS = 20_000;
/** 검색 응답 전 시세 보강 상한 — Yahoo 큐 대기를 줄인다 */
const SEARCH_QUOTE_ENRICH_MAX = (() => {
  const n = Number(process.env.STOCK_SEARCH_QUOTE_ENRICH_MAX ?? 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(24, Math.floor(n)) : 10;
})();
/** 한글 국내 검색 시 로컬 유니버스만으로 충분하면 Yahoo 검색 생략 */
const KR_HANGUL_SKIP_YAHOO_MIN = 12;
/** 검색 쿼리 캐시 — TTL 경과 후에도 Map에 남지 않도록 정리 */
const SEARCH_CACHE_MAX_KEYS = 240;
const SEARCH_CACHE_DEAD_MS = CACHE_MS * 30;
/** @type {Map<string, { at: number, payload: { quotes: unknown[] } }>} */
const cache = new Map();

function pruneStockSearchCache() {
  const now = Date.now();
  for (const [key, hit] of cache) {
    if (now - hit.at > SEARCH_CACHE_DEAD_MS) cache.delete(key);
  }
  if (cache.size <= SEARCH_CACHE_MAX_KEYS) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  const remove = cache.size - SEARCH_CACHE_MAX_KEYS;
  for (let i = 0; i < remove; i++) cache.delete(sorted[i][0]);
}

const KR_EX = new Set([
  "KSC",
  "KOE",
  "KSQ",
  "KOS",
  "KON",
  "KRX",
  "KQ",
]);

const ALLOW_QUOTE_TYPES = new Set(["EQUITY", "ETF", "INDEX"]);

import { getCachedUniverse, warmUniverseCache } from "./universe.js";

function loadUniverseJsonFallback(name) {
  try {
    const raw = readFileSync(join(__dirname, "data", name), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function getUniverseKrRows() {
  const cached = getCachedUniverse();
  if (cached?.kr?.length) return cached.kr;
  return loadUniverseJsonFallback("universe-kr.json");
}

function getUniverseUsRows() {
  const cached = getCachedUniverse();
  if (cached?.us?.length) return cached.us;
  return loadUniverseJsonFallback("universe-us.json");
}

/**
 * Yahoo 검색 API가 넣어 주는 현재가 힌트(있으면 스냅샷 호출을 줄인다).
 * @param {Record<string, unknown>} src
 * @param {Record<string, unknown>} rowOut
 */
function mergeHintFromSearchQuote(src, rowOut) {
  if (!src || typeof src !== "object") return;
  const p = Number(src.regularMarketPrice);
  if (Number.isFinite(p) && p > 0) rowOut.price = p;
  const pct = Number(src.regularMarketChangePercent);
  if (Number.isFinite(pct)) rowOut.changePercent = pct;
  const cur = src.currency;
  if (typeof cur === "string" && cur.trim()) rowOut.currency = cur.trim();
  const ms = src.marketState ?? src.exchangeMarketState;
  if (typeof ms === "string" && ms.trim()) rowOut.marketState = ms.trim();
  const vol = Number(src.regularMarketVolume);
  const px = Number(rowOut.price ?? src.regularMarketPrice);
  if (Number.isFinite(vol) && vol > 0 && Number.isFinite(px) && px > 0) {
    rowOut.turnover = vol * px;
  }
}

/**
 * @param {object[]} rows
 */
async function enrichSearchQuotePrices(rows) {
  if (SEARCH_QUOTE_ENRICH_MAX <= 0) return rows;
  const need = rows
    .filter(
      (r) =>
        r.price == null || !Number.isFinite(r.price) || Number(r.price) <= 0,
    )
    .slice(0, SEARCH_QUOTE_ENRICH_MAX)
    .map((r) => String(r.symbol ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (need.length === 0) return rows;

  const snaps = await fetchQuoteSnapshotsForSymbols(need);
  return rows.map((row) => {
    const sym = String(row.symbol ?? "")
      .trim()
      .toUpperCase();
    const q = snaps[sym];
    if (!q?.price || !Number.isFinite(q.price)) return row;
    const px = q.price;
    return {
      ...row,
      price: px,
      changePercent:
        row.changePercent != null && Number.isFinite(row.changePercent)
          ? row.changePercent
          : q.changePercent,
      currency: row.currency ?? q.currency,
      marketState: row.marketState,
      turnover: row.turnover,
    };
  });
}

/**
 * @param {{ symbol?: string; exchange?: string; quoteType?: string }} q
 * @returns {"kr" | "us" | null}
 */
function isYahooIndexSymbol(symbol) {
  return /^\^[A-Z][A-Z0-9.-]{0,23}$/.test(String(symbol ?? "").trim().toUpperCase());
}

function inferMarket(q) {
  const symbol = String(q.symbol ?? "").trim().toUpperCase();
  const exchange = String(q.exchange ?? "").toUpperCase();
  const qt = String(q.quoteType ?? "").toUpperCase();

  if (isYahooIndexSymbol(symbol)) {
    if (KR_EX.has(exchange) || /^\^K[QS]/.test(symbol)) return "kr";
    return "us";
  }

  if (/\.(KS|KQ)$/.test(symbol)) return "kr";
  if (KR_EX.has(exchange)) {
    if (qt === "" || ALLOW_QUOTE_TYPES.has(qt)) return "kr";
    return null;
  }
  if (qt === "" || ALLOW_QUOTE_TYPES.has(qt)) {
    if (symbol.includes("=F") || /-USD(T)?$/i.test(symbol)) return null;
    return "us";
  }
  return null;
}

/**
 * Yahoo는 한글 쿼리에 quotes를 비우는 경우가 많아, 로컬 유니버스(이름·코드)로 보강한다.
 * @param {string} query
 * @param {"kr" | "us"} market
 * @param {Set<string>} seen
 * @param {object[]} out
 */
function appendLocalUniverseMatches(query, market, seen, out) {
  const t = String(query ?? "").trim();
  if (!t) return;
  const qLower = t.toLowerCase();
  const rows = market === "kr" ? getUniverseKrRows() : getUniverseUsRows();
  for (const row of rows) {
    if (out.length >= 28) break;
    let sym = String(row.symbol ?? "").trim().toUpperCase();
    const nm = String(row.name ?? "");
    if (!sym) continue;
    if (market === "kr" && /^\d{6}$/.test(sym)) sym = `${sym}.KS`;
    if (market === "kr" && !/\.(KS|KQ)$/i.test(sym)) continue;
    if (market === "us" && /\.(KS|KQ)$/i.test(sym)) continue;
    if (market === "us" && !isPrimaryUsSearchSymbol(sym)) continue;

    const symBare = sym.replace(/\.(KS|KQ)$/i, "");
    const hit =
      nm.includes(t) ||
      nm.toLowerCase().includes(qLower) ||
      sym.toLowerCase().includes(qLower) ||
      symBare.includes(t) ||
      symBare.toLowerCase().includes(qLower);

    if (!hit) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const base = {
      symbol: sym,
      name: resolveDisplayName(sym, nm),
      market,
      quoteType: "EQUITY",
    };
    if (market === "us") {
      const nk = getKoreanStockName(sym);
      const en = nm.trim() && !hasHangul(nm) ? nm.trim() : null;
      out.push({
        ...base,
        nameKo: nk ?? null,
        nameEn: en,
      });
    } else {
      out.push(base);
    }
  }
}

/**
 * @param {string} query
 * @param {"kr" | "us"} market
 */
export async function searchStocks(query, market) {
  await warmUniverseCache();
  const q = String(query ?? "").trim();
  if (q.length < 1) return { quotes: [] };
  if (q.length > 80) {
    const err = new Error("검색어가 너무 깁니다.");
    err.code = "BAD_QUERY";
    throw err;
  }

  const cacheKey = `${market}:${q.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.payload;
  }

  const qHasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/.test(q);
  const seen = new Set();
  /** @type {object[]} */
  const quotes = [];

  const localKrHangulFirst = qHasHangul && market === "kr";
  if (localKrHangulFirst) {
    appendLocalUniverseMatches(q, market, seen, quotes);
  }

  const skipYahoo =
    localKrHangulFirst && quotes.length >= KR_HANGUL_SKIP_YAHOO_MIN;

  let data = { quotes: [] };
  if (!skipYahoo) {
    try {
      data = await yahooGet(
        `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=40&newsCount=0`,
      );
    } catch {
      data = { quotes: [] };
    }
  }

  const raw = Array.isArray(data?.quotes) ? data.quotes : [];

  for (const row of raw) {
    let sym = String(row.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    if (market === "kr" && /^\d{6}$/.test(sym)) sym = `${sym}.KS`;
    const m = inferMarket({ ...row, symbol: sym });
    if (m !== market) continue;
    if (market === "us" && !isPrimaryUsSearchSymbol(sym)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const name = resolveDisplayName(sym, row.shortName, row.longName);
    const rowOut = {
      symbol: sym,
      name,
      market: m,
      exchange: row.exchange ? String(row.exchange) : undefined,
      quoteType: row.quoteType ? String(row.quoteType) : undefined,
    };
    if (market === "us") {
      rowOut.nameKo = getKoreanStockName(sym) ?? null;
      rowOut.nameEn = englishYahooName(row.shortName, row.longName) || null;
    }
    mergeHintFromSearchQuote(row, rowOut);
    quotes.push(rowOut);
    if (quotes.length >= 28) break;
  }

  if (!localKrHangulFirst && (quotes.length === 0 || qHasHangul)) {
    appendLocalUniverseMatches(q, market, seen, quotes);
  }

  const sliced = quotes.slice(0, 24);
  const enriched = await enrichSearchQuotePrices(sliced);
  const finalQuotes =
    market === "us"
      ? enriched.filter((row) => isUsSearchResultRow(row))
      : enriched;
  const payload = { quotes: finalQuotes };
  cache.set(cacheKey, { at: Date.now(), payload });
  pruneStockSearchCache();
  return payload;
}
