import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooPost } from "./yahoo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KR_TARGET = 300;
const US_TARGET = 500;

/** S&P 500 구성종목 (datasets/s-and-p-500-companies) */
const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

const SP500_FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

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

async function fetchScreenerPage(region, offset, size) {
  const body = {
    size,
    offset,
    sortField: "market_cap.basic",
    sortType: "DESC",
    quoteType: "EQUITY",
    query: {
      operator: "AND",
      operands: [{ operator: "eq", operands: ["region", region] }],
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

  for (let offset = 0; offset < target && out.length < target; offset += 250) {
    try {
      const page = await fetchScreenerPage(
        region,
        offset,
        Math.min(250, target - offset),
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
