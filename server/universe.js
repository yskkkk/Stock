import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { boxRangeCryptoScanEnabled } from "./box-range/constants.js";
import { parseKrxListCsvAll } from "./kr-stock-search-index.js";
import { resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooPost } from "./yahoo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KR_TARGET = 300;
const US_TARGET = 500;

/** Yahoo screener exchange=NMS (Nasdaq Global Select/Market/Capital) */
const NASDAQ_EXCHANGE = "NMS";

/** 토스증권 미국주식 — NASDAQ·NYSE·NYSE American (Yahoo NMS·NYQ·ASE) */
const TOSS_US_EXCHANGES = ["NMS", "NYQ", "ASE"];

const NASDAQ_EQUITY_TARGET = (() => {
  const n = Number(process.env.STOCK_NASDAQ_UNIVERSE_TARGET ?? 4500);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 8000) : 4500;
})();

/** @type {number} 토스 미국주식 거래 가능 규모(~1만) */
export const TOSS_US_EQUITY_TARGET = (() => {
  const n = Number(process.env.STOCK_TOSS_US_UNIVERSE_TARGET ?? 10_000);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 12_000) : 10_000;
})();

/** @type {number} 토스 국내주식 — KRX 전체 상장 (~2.5천) */
export const TOSS_KR_EQUITY_TARGET = (() => {
  const n = Number(process.env.STOCK_TOSS_KR_UNIVERSE_TARGET ?? 3_000);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 5_000) : 3_000;
})();

const TOSS_US_UNIVERSE_CACHE_MS = 6 * 60 * 60_000;
const KR_FULL_UNIVERSE_CACHE_MS = 6 * 60 * 60_000;
/** @type {{ list: Array<{ symbol: string; name: string }>; at: number } | null} */
let tossUsUniverseCache = null;
/** @type {{ list: Array<{ symbol: string; name: string }>; at: number } | null} */
let krFullUniverseCache = null;

const BOX_SCAN_KR_TARGET = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_KR_TARGET ?? KR_TARGET);
  return Number.isFinite(n) && n >= 50 ? Math.min(n, 500) : KR_TARGET;
})();

/** S&P 500 구성종목 (datasets/s-and-p-500-companies) */
const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

const SP500_FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const KRX_LIST_CSV_URL =
  "https://raw.githubusercontent.com/dalinaum/rs/main/krx-list.csv";

function loadFallback(name) {
  try {
    const raw = readFileSync(join(__dirname, "data", name), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** CSV Symbol → Yahoo 티커 (BRK.B → BRK-B) */
function yahooSymbolFromSp500(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
}

/**
 * @param {string} csvText
 * @returns {Array<{ symbol: string; name: string }>}
 */
function parseSp500Csv(csvText) {
  const lines = String(csvText ?? "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const symIdx = header.indexOf("symbol");
  const nameIdx = header.findIndex((h) => h === "security" || h === "name");

  /** @type {Array<{ symbol: string; name: string }>} */
  const out = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const firstComma = line.indexOf(",");
    if (firstComma < 0) continue;
    const rawSym = line.slice(0, firstComma).trim();
    const sym = yahooSymbolFromSp500(rawSym);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    const rest = line.slice(firstComma + 1);
    const quoted = rest.match(/^"([^"]*)"/);
    const plain = rest.match(/^([^,]*)/);
    const nm = (
      quoted?.[1] ??
      plain?.[1] ??
      (nameIdx >= 0 ? rest.split(",")[0] : sym)
    )
      .trim()
      .replace(/^"|"$/g, "") || sym;
    out.push({
      symbol: sym,
      name: resolveDisplayName(sym, nm, nm),
    });
  }
  return out;
}

async function fetchUsSp500Universe() {
  try {
    const res = await fetch(SP500_CSV_URL, {
      headers: { "User-Agent": SP500_FETCH_UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`S&P 500 CSV HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseSp500Csv(text);
    if (parsed.length < 400) {
      throw new Error(`S&P 500 구성종목 수 부족 (${parsed.length})`);
    }
    return parsed.slice(0, US_TARGET);
  } catch (e) {
    console.warn(
      "[universe] S&P 500 CSV:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

/**
 * @param {string} region
 * @param {number} offset
 * @param {number} size
 * @param {string} [exchange] — 예: NMS(나스닥)
 */
async function fetchScreenerPage(region, offset, size, exchange = "") {
  /** @type {object[]} */
  const operands = [{ operator: "eq", operands: ["region", region] }];
  const ex = String(exchange ?? "").trim();
  if (ex) {
    operands.push({ operator: "eq", operands: ["exchange", ex] });
  }
  const body = {
    size,
    offset,
    sortField: "market_cap.basic",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: {
      operator: "AND",
      operands,
    },
  };

  const data = await yahooPost("/v1/finance/screener", body);
  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  return quotes
    .map((q) => ({
      symbol: String(q.symbol ?? "").toUpperCase(),
      name: resolveDisplayName(q.symbol, q.shortName, q.longName),
    }))
    .filter((q) => q.symbol);
}

async function fetchUniverseRegion(region, target) {
  const out = [];
  const seen = new Set();

  for (
    let offset = 0;
    offset < Math.max(target * 2, 500) && out.length < target;
    offset += 250
  ) {
    try {
      const page = await fetchScreenerPage(
        region,
        offset,
        Math.min(250, Math.max(50, target - out.length)),
      );
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 100) break;
    } catch {
      break;
    }
  }

  return out.slice(0, target);
}

/**
 * 거래소 필터(NMS=나스닥 등) — EQUITY screener 페이지네이션
 * @param {string} region
 * @param {string} exchange
 * @param {number} target
 */
export async function fetchExchangeEquityUniverse(region, exchange, target) {
  await getYahooSession();
  const out = [];
  const seen = new Set();
  const ex = String(exchange ?? "").trim();
  if (!ex) return [];

  for (
    let offset = 0;
    offset < Math.max(target * 4, 16_000) && out.length < target;
    offset += 250
  ) {
    try {
      const page = await fetchScreenerPage(
        region,
        offset,
        250,
        ex,
      );
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 50) break;
    } catch (e) {
      console.warn(
        "[universe] exchange screener:",
        ex,
        e instanceof Error ? e.message : e,
      );
      break;
    }
  }

  return out.slice(0, target);
}

/** 나스닥 상장 EQUITY (Yahoo exchange NMS) */
export async function fetchNasdaqEquityUniverse(
  target = NASDAQ_EQUITY_TARGET,
) {
  const list = await fetchExchangeEquityUniverse("us", NASDAQ_EXCHANGE, target);
  console.info("[universe] NASDAQ equity", { count: list.length, target });
  return list;
}

/**
 * US region EQUITY — exchange 필터 없이 screener 페이지네이션
 * @param {number} target
 */
async function fetchUsEquityRegionWide(target) {
  await getYahooSession();
  const out = [];
  const seen = new Set();

  for (
    let offset = 0;
    offset < 24_000 && out.length < target;
    offset += 250
  ) {
    try {
      const page = await fetchScreenerPage("us", offset, 250);
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 50) break;
    } catch (e) {
      console.warn(
        "[universe] US region screener:",
        e instanceof Error ? e.message : e,
      );
      break;
    }
  }

  return out.slice(0, target);
}

/**
 * 토스증권 미국주식 범위 — NMS·NYQ·ASE 병합 + 부족 시 US region 보충
 * @param {number} [target]
 */
export async function fetchTossUsEquityUniverse(
  target = TOSS_US_EQUITY_TARGET,
) {
  if (
    tossUsUniverseCache?.list?.length &&
    Date.now() - tossUsUniverseCache.at < TOSS_US_UNIVERSE_CACHE_MS
  ) {
    return tossUsUniverseCache.list.slice(0, target);
  }

  /** @type {Array<{ symbol: string; name: string }>[]} */
  const parts = [];
  const perEx = Math.ceil(target / TOSS_US_EXCHANGES.length) + 200;
  for (const ex of TOSS_US_EXCHANGES) {
    parts.push(await fetchExchangeEquityUniverse("us", ex, perEx));
  }
  let merged = mergeSymbolUniverse(...parts);
  if (merged.length < target * 0.75) {
    merged = mergeSymbolUniverse(
      merged,
      await fetchUsEquityRegionWide(target),
    );
  }
  merged = merged.slice(0, target);
  tossUsUniverseCache = { list: merged, at: Date.now() };
  console.info("[universe] toss-us equity", {
    count: merged.length,
    target,
    exchanges: TOSS_US_EXCHANGES,
  });
  return merged;
}

/** 매집봉(US) 스캔 SSOT scope — 토스 미국주식 전체 */
export const BOOK_ACCUM_US_UNIVERSE_SCOPE = "toss-us";

/** 매집봉(KR) 스캔 SSOT scope — KRX 전체 상장 */
export const BOOK_ACCUM_KR_UNIVERSE_SCOPE = "kr-full";

/** US vault 주봉 스캔 — 나스닥(NMS) 전종목 */
export const US_VAULT_WEEKLY_UNIVERSE_SCOPE = "nasdaq";

/** @param {unknown} timeframe */
function isWeeklyVaultTimeframe(timeframe) {
  const v = String(timeframe ?? "")
    .trim()
    .toLowerCase();
  return v === "1wk" || v === "weekly" || v === "week" || v === "w";
}

/**
 * @param {"kr"|"us"} market
 * @param {unknown} [timeframe]
 */
export function resolveVaultScanUniverseScope(market, timeframe = "1d") {
  if (market === "kr") return "kr-top";
  return isWeeklyVaultTimeframe(timeframe)
    ? US_VAULT_WEEKLY_UNIVERSE_SCOPE
    : "sp500";
}

/**
 * @param {"kr"|"us"} market
 * @param {unknown} [timeframe]
 */
export function resolveBookAccumUniverseScope(market, _timeframe = "1d") {
  if (market === "kr") return BOOK_ACCUM_KR_UNIVERSE_SCOPE;
  return BOOK_ACCUM_US_UNIVERSE_SCOPE;
}

/**
 * @param {"nasdaq"|"toss-us"|"toss"|"us-full"|"us"|"sp500"} primaryScope
 */
async function resolveUsEquityUniverse(primaryScope) {
  const key = String(primaryScope ?? "")
    .trim()
    .toLowerCase();
  /** @type {Array<{ symbol: string; name: string }>} */
  let us = [];
  let scope = key;

  try {
    if (key === "nasdaq") {
      us = await fetchNasdaqEquityUniverse();
    } else if (
      key === "toss-us" ||
      key === "toss" ||
      key === "us-full" ||
      key === "us"
    ) {
      us = await fetchTossUsEquityUniverse();
      scope = "toss-us";
    } else if (key === "sp500") {
      const uni = await loadUniverse();
      us = Array.isArray(uni.us) ? uni.us : [];
      scope = "sp500";
    }
  } catch (e) {
    console.warn(
      "[universe] US equity primary fetch failed:",
      key,
      e instanceof Error ? e.message : e,
    );
  }

  if (us.length < 50 && key !== "nasdaq") {
    try {
      const nd = await fetchNasdaqEquityUniverse();
      if (nd.length > us.length) {
        us = nd;
        scope =
          key === "toss-us" || key === "toss" || key === "us-full" || key === "us"
            ? "nasdaq-fallback"
            : "nasdaq";
      }
    } catch {
      /* fallback chain */
    }
  }

  if (us.length < 50) {
    try {
      const uni = await loadUniverse();
      const sp = Array.isArray(uni.us) ? uni.us : [];
      if (sp.length > us.length) {
        us = sp;
        scope = "sp500-fallback";
      }
    } catch {
      /* fallback chain */
    }
  }

  return { us, scope };
}

/**
 * 종목보관함 vault 스캔 유니버스 — US 주봉은 나스닥, US 일봉·KR은 기존
 * @param {"kr"|"us"} market
 * @param {unknown} [timeframe]
 */
export async function loadVaultScanUniverse(market, timeframe = "1d") {
  if (market === "kr") {
    const uni = await loadUniverse();
    return {
      kr: Array.isArray(uni.kr) ? uni.kr : [],
      us: [],
      scope: "kr-top",
    };
  }
  const scopeKey = resolveVaultScanUniverseScope(market, timeframe);
  if (scopeKey === "sp500") {
    const uni = await loadUniverse();
    return {
      kr: [],
      us: Array.isArray(uni.us) ? uni.us : [],
      scope: "sp500",
    };
  }
  const { us, scope } = await resolveUsEquityUniverse(US_VAULT_WEEKLY_UNIVERSE_SCOPE);
  return { kr: [], us, scope };
}

/**
 * 토스증권 국내주식 범위 — KRX 전체 상장 (KOSPI·KOSDAQ)
 * @param {number} [target]
 */
export async function fetchKrFullEquityUniverse(
  target = TOSS_KR_EQUITY_TARGET,
) {
  if (
    krFullUniverseCache?.list?.length &&
    Date.now() - krFullUniverseCache.at < KR_FULL_UNIVERSE_CACHE_MS
  ) {
    return krFullUniverseCache.list.slice(0, target);
  }

  /** @type {Array<{ symbol: string; name: string }>} */
  let list = [];
  try {
    const res = await fetch(KRX_LIST_CSV_URL, {
      headers: { "User-Agent": SP500_FETCH_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`KRX list HTTP ${res.status}`);
    const rows = parseKrxListCsvAll(await res.text());
    if (rows.length < 500) {
      throw new Error(`KRX 목록 수 부족 (${rows.length})`);
    }
    list = rows.map(({ symbol, name }) => ({ symbol, name }));
  } catch (e) {
    console.warn(
      "[universe] kr-full CSV:",
      e instanceof Error ? e.message : e,
    );
  }

  if (list.length < 500) {
    try {
      const uni = await loadUniverse();
      const krTop = Array.isArray(uni.kr) ? uni.kr : [];
      if (krTop.length > list.length) list = krTop;
    } catch {
      /* fallback chain */
    }
  }

  if (list.length < 50) {
    list = loadFallback("universe-kr.json");
  }

  list = list.slice(0, target);
  krFullUniverseCache = { list, at: Date.now() };
  console.info("[universe] kr-full equity", { count: list.length, target });
  return list;
}

/**
 * 매집봉 스캔 유니버스
 * @param {"kr-full"|"krx-all"|"toss-kr"|"sp500"|"nasdaq"|"toss-us"|"us"} scope
 */
export async function loadBookAccumScanUniverse(scope = BOOK_ACCUM_US_UNIVERSE_SCOPE) {
  const key = String(scope ?? BOOK_ACCUM_US_UNIVERSE_SCOPE)
    .trim()
    .toLowerCase();

  if (
    key === "kr-full" ||
    key === "krx-all" ||
    key === "toss-kr" ||
    key === BOOK_ACCUM_KR_UNIVERSE_SCOPE
  ) {
    const kr = await fetchKrFullEquityUniverse();
    return { kr, us: [], scope: BOOK_ACCUM_KR_UNIVERSE_SCOPE };
  }

  if (key === "sp500") {
    const uni = await loadUniverse();
    return {
      kr: Array.isArray(uni.kr) ? uni.kr : [],
      us: Array.isArray(uni.us) ? uni.us : [],
      scope: "sp500",
    };
  }
  const { us, scope: resolvedScope } = await resolveUsEquityUniverse(key);
  return { kr: [], us, scope: resolvedScope };
}

/**
 * @param {string} text
 * @param {number} target
 */
function parseKrMarketCapCsv(text, target) {
  const lines = String(text ?? "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const codeIdx = header.indexOf("Code");
  const nameIdx = header.indexOf("Name");
  const marketIdx = header.indexOf("Market");
  const marcapIdx = header.indexOf("Marcap");
  if (codeIdx < 0 || nameIdx < 0 || marcapIdx < 0) return [];

  /** @type {Array<{ symbol: string; name: string; marcap: number }>} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const code = String(p[codeIdx] ?? "").trim().padStart(6, "0");
    if (!/^\d{6}$/.test(code)) continue;
    const market = String(p[marketIdx] ?? "").trim().toUpperCase();
    const suffix =
      market.includes("KOSDAQ") || market === "KQ" ? "KQ" : "KS";
    const sym = `${code}.${suffix}`;
    const marcap = Number(p[marcapIdx]);
    rows.push({
      symbol: sym,
      name: resolveDisplayName(sym, String(p[nameIdx] ?? sym).trim(), sym),
      marcap: Number.isFinite(marcap) ? marcap : 0,
    });
  }
  rows.sort((a, b) => b.marcap - a.marcap);
  return rows.slice(0, target).map(({ symbol, name }) => ({ symbol, name }));
}

/**
 * @param {string} text
 * @returns {Array<{ symbol: string; name: string; marcap: number }>}
 */
function parseKrMarketCapCsvRows(text) {
  const lines = String(text ?? "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const codeIdx = header.indexOf("Code");
  const nameIdx = header.indexOf("Name");
  const marketIdx = header.indexOf("Market");
  const marcapIdx = header.indexOf("Marcap");
  if (codeIdx < 0 || nameIdx < 0 || marcapIdx < 0) return [];

  /** @type {Array<{ symbol: string; name: string; marcap: number }>} */
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const code = String(p[codeIdx] ?? "").trim().padStart(6, "0");
    if (!/^\d{6}$/.test(code)) continue;
    const market = String(p[marketIdx] ?? "").trim().toUpperCase();
    const suffix =
      market.includes("KOSDAQ") || market === "KQ" ? "KQ" : "KS";
    const sym = `${code}.${suffix}`;
    const marcap = Number(p[marcapIdx]);
    rows.push({
      symbol: sym,
      name: resolveDisplayName(sym, String(p[nameIdx] ?? sym).trim(), sym),
      marcap: Number.isFinite(marcap) ? marcap : 0,
    });
  }
  rows.sort((a, b) => b.marcap - a.marcap);
  return rows;
}

/** @type {Map<string, number> | null} */
let krMarketCapCache = null;
/** @type {number} */
let krMarketCapCacheAt = 0;
const KR_MARKET_CAP_CACHE_MS = 6 * 60 * 60_000;

/** @returns {Promise<Map<string, number>>} symbol → 시가총액(KRW) */
export async function loadKrSymbolMarketCapKrwMap(target = KR_TARGET) {
  if (
    krMarketCapCache &&
    Date.now() - krMarketCapCacheAt < KR_MARKET_CAP_CACHE_MS
  ) {
    return krMarketCapCache;
  }
  try {
    const res = await fetch(KRX_LIST_CSV_URL, {
      headers: { "User-Agent": SP500_FETCH_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`KRX list HTTP ${res.status}`);
    const rows = parseKrMarketCapCsvRows(await res.text()).slice(0, target);
    const map = new Map();
    for (const row of rows) {
      map.set(row.symbol.trim().toUpperCase(), row.marcap);
    }
    krMarketCapCache = map;
    krMarketCapCacheAt = Date.now();
    return map;
  } catch (e) {
    console.warn(
      "[universe] KR market-cap map:",
      e instanceof Error ? e.message : e,
    );
    return krMarketCapCache ?? new Map();
  }
}

async function fetchKrTopMarketCapCsv() {
  try {
    const res = await fetch(KRX_LIST_CSV_URL, {
      headers: { "User-Agent": SP500_FETCH_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`KRX list HTTP ${res.status}`);
    const parsed = parseKrMarketCapCsv(await res.text(), BOX_SCAN_KR_TARGET);
    if (parsed.length < 100) {
      throw new Error(`KRX 시총 상위 수 부족 (${parsed.length})`);
    }
    console.info("[universe] KR top market-cap CSV", parsed.length);
    return parsed;
  } catch (e) {
    console.warn(
      "[universe] KRX list CSV:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

/**
 * @param {Array<{ symbol: string; name: string }>[]} lists
 */
function mergeSymbolUniverse(...lists) {
  const seen = new Set();
  /** @type {Array<{ symbol: string; name: string }>} */
  const out = [];
  for (const list of lists) {
    for (const item of list) {
      const sym = String(item?.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push({
        symbol: sym,
        name: item?.name ? String(item.name) : sym,
      });
    }
  }
  return out;
}

/**
 * 박스권 카탈로그 스캔 전용: S&P500 + 국내 시총 상위 300
 * @returns {Promise<{ kr: object[]; us: object[]; crypto: object[]; meta: { kr: number; usSp500: number; usTotal: number } }>}
 */
export async function loadBoxRangeCatalogUniverse() {
  let kr = [];
  let sp500 = [];

  try {
    await getYahooSession();
    sp500 = await fetchUsSp500Universe();
    kr = await fetchKrTopMarketCapCsv();
    if (kr.length < BOX_SCAN_KR_TARGET * 0.5) {
      const screenerKr = await fetchUniverseRegion("kr", BOX_SCAN_KR_TARGET);
      kr = mergeSymbolUniverse(kr, screenerKr);
    }
  } catch (e) {
    console.warn(
      "[universe] box-range catalog:",
      e instanceof Error ? e.message : e,
    );
  }

  const krFallback = loadFallback("universe-kr.json");
  const usFallback = loadFallback("universe-us.json");

  if (kr.length < 50) kr = krFallback;
  const seenKr = new Set();
  kr = [...kr, ...krFallback]
    .filter((s) => {
      if (seenKr.has(s.symbol)) return false;
      seenKr.add(s.symbol);
      return true;
    })
    .slice(0, BOX_SCAN_KR_TARGET);

  const us = mergeSymbolUniverse(sp500, usFallback).slice(0, US_TARGET);

  let crypto = [];
  if (boxRangeCryptoScanEnabled()) {
    try {
      const { assets } = await loadCryptoWatchlistTen();
      crypto = assets.map((a) => ({
        symbol: a.symbol,
        name: a.name ?? a.symbol,
      }));
    } catch {
      crypto = [];
    }
  }

  const meta = {
    kr: kr.length,
    usSp500: us.length,
    usTotal: us.length,
  };
  console.info("[universe] box-range catalog universe", meta);
  return { kr, us, crypto, meta };
}

let universeCache = null;
let universeCachePromise = null;

export async function loadUniverse() {
  let kr = [];
  let us = [];

  try {
    kr = await fetchKrTopMarketCapCsv();
    if (kr.length < KR_TARGET * 0.5) {
      await getYahooSession();
      const screenerKr = await fetchUniverseRegion("kr", KR_TARGET);
      kr = mergeSymbolUniverse(kr, screenerKr);
    }
    us = await fetchUsSp500Universe();
  } catch {
    /* fallback */
  }

  const krFallback = loadFallback("universe-kr.json");
  const usFallback = loadFallback("universe-us.json");

  if (kr.length < 50) kr = krFallback;
  if (us.length < 50) us = usFallback;

  const seenKr = new Set();
  const seenUs = new Set();
  kr = [...kr, ...krFallback]
    .filter((s) => {
      if (seenKr.has(s.symbol)) return false;
      seenKr.add(s.symbol);
      return true;
    })
    .slice(0, KR_TARGET);
  us = [...us, ...usFallback]
    .filter((s) => {
      if (seenUs.has(s.symbol)) return false;
      seenUs.add(s.symbol);
      return true;
    })
    .slice(0, US_TARGET);

  let crypto = [];
  if (boxRangeCryptoScanEnabled()) {
    try {
      const { assets } = await loadCryptoWatchlistTen();
      crypto = assets.map((a) => ({
        symbol: a.symbol,
        name: a.name ?? a.symbol,
      }));
    } catch {
      crypto = [];
    }
  }

  const payload = { kr, us, crypto };
  universeCache = payload;
  return payload;
}

/** 종목 검색 로컬 매칭 — 스크리너와 동일 유니버스 */
export function getCachedUniverse() {
  return universeCache;
}

export function warmUniverseCache() {
  if (!universeCachePromise) {
    universeCachePromise = loadUniverse()
      .catch((e) => {
        console.warn(
          "[universe] warm:",
          e instanceof Error ? e.message : e,
        );
        return { kr: loadFallback("universe-kr.json"), us: loadFallback("universe-us.json"), crypto: [] };
      })
      .finally(() => {
        universeCachePromise = null;
      });
  }
  return universeCachePromise;
}
