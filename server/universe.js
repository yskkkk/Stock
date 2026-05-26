import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooPost } from "./yahoo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KR_TARGET = 300;
const US_TARGET = 500;

/** 박스권 카탈로그 — 나스닥(시총순) 추가 스캔 상한 */
const BOX_SCAN_NASDAQ_TARGET = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_NASDAQ_TARGET ?? 3000);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 6000) : 3000;
})();

const BOX_SCAN_KR_TARGET = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_KR_TARGET ?? KR_TARGET);
  return Number.isFinite(n) && n >= 50 ? Math.min(n, 500) : KR_TARGET;
})();

/** S&P 500 구성종목 (datasets/s-and-p-500-companies) */
const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

const SP500_FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const NASDAQ_LISTED_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";

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
 * @param {string} region
 * @param {string} exchange
 * @param {number} target
 */
async function fetchUniverseByExchange(region, exchange, target) {
  const out = [];
  const seen = new Set();
  const maxOffset = Math.max(target * 2, target + 250);

  for (let offset = 0; offset < maxOffset && out.length < target; offset += 250) {
    try {
      const page = await fetchScreenerPage(
        region,
        offset,
        Math.min(250, target - out.length + 50),
        exchange,
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
        "[universe] screener",
        region,
        exchange || "all",
        e instanceof Error ? e.message : e,
      );
      break;
    }
  }

  return out.slice(0, target);
}

/**
 * @param {string} text
 * @returns {Array<{ symbol: string; name: string }>}
 */
function parseNasdaqListedTxt(text) {
  const lines = String(text ?? "")
    .trim()
    .split(/\r?\n/);
  /** @type {Array<{ symbol: string; name: string }>} */
  const out = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const p = line.split("|");
    const sym = String(p[0] ?? "")
      .trim()
      .toUpperCase();
    if (!sym || sym === "FILE CREATION TIME" || seen.has(sym)) continue;
    if (p[3] === "Y" || p[6] === "Y") continue;
    const name = String(p[1] ?? sym).trim();
    seen.add(sym);
    out.push({ symbol: sym, name: resolveDisplayName(sym, name, name) });
  }
  return out;
}

async function fetchNasdaqListedFromTrader() {
  try {
    const res = await fetch(NASDAQ_LISTED_URL, {
      headers: { "User-Agent": SP500_FETCH_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`NASDAQ listed HTTP ${res.status}`);
    const parsed = parseNasdaqListedTxt(await res.text());
    if (parsed.length < 500) {
      throw new Error(`NASDAQ listed 수 부족 (${parsed.length})`);
    }
    return parsed;
  } catch (e) {
    console.warn(
      "[universe] NASDAQ listed.txt:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
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

/** S&P500 외 나스닥 상장 전체 — 스크리너 실패 시 nasdaqlisted.txt */
async function fetchUsNasdaqUniverse() {
  for (const ex of ["NMS", "NAS"]) {
    const list = await fetchUniverseByExchange("us", ex, BOX_SCAN_NASDAQ_TARGET);
    if (list.length >= 200) {
      console.info("[universe] US NASDAQ exchange", ex, list.length);
      return list;
    }
  }
  const broad = await fetchUniverseRegion("us", BOX_SCAN_NASDAQ_TARGET);
  if (broad.length >= 200) {
    console.info("[universe] US market-cap screener", broad.length);
    return broad;
  }
  const listed = await fetchNasdaqListedFromTrader();
  console.info("[universe] US NASDAQ listed.txt", listed.length);
  return listed;
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
 * 박스권 카탈로그 스캔 전용: S&P500 + 나스닥 시총순 + 국내 시총 300
 * @returns {Promise<{ kr: object[]; us: object[]; crypto: object[]; meta: { kr: number; usSp500: number; usNasdaq: number; usTotal: number } }>}
 */
export async function loadBoxRangeCatalogUniverse() {
  let kr = [];
  let sp500 = [];
  let nasdaq = [];

  try {
    await getYahooSession();
    sp500 = await fetchUsSp500Universe();
    kr = await fetchKrTopMarketCapCsv();
    if (kr.length < BOX_SCAN_KR_TARGET * 0.5) {
      const screenerKr = await fetchUniverseRegion("kr", BOX_SCAN_KR_TARGET);
      kr = mergeSymbolUniverse(kr, screenerKr);
    }
    nasdaq = await fetchUsNasdaqUniverse();
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

  const us = mergeSymbolUniverse(sp500, nasdaq, usFallback);

  let crypto = [];
  try {
    const { assets } = await loadCryptoWatchlistTen();
    crypto = assets.map((a) => ({
      symbol: a.symbol,
      name: a.name ?? a.symbol,
    }));
  } catch {
    crypto = [];
  }

  const meta = {
    kr: kr.length,
    usSp500: sp500.length,
    usNasdaq: nasdaq.length,
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
    await getYahooSession();
    [kr, us] = await Promise.all([
      fetchUniverseRegion("kr", KR_TARGET),
      fetchUsSp500Universe(),
    ]);
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
  try {
    const { assets } = await loadCryptoWatchlistTen();
    crypto = assets.map((a) => ({
      symbol: a.symbol,
      name: a.name ?? a.symbol,
    }));
  } catch {
    crypto = [];
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
