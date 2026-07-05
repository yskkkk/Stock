/**
 * S&P 500 GICS 섹터·종목 (datasets/s-and-p-500-companies CSV).
 */
import { getKoreanStockName, hasHangul } from "./names-ko.js";
import { resolveUsKoreanStockNamesBatch } from "./us-naver-korean-name.js";
import { yahooGet } from "./yahoo.js";

const PINION_KO_MAP_URL =
  "https://raw.githubusercontent.com/pinion05/kr-us-stock-name-ticker-maps/main/data/us/us-stock-ticker-to-ko-en-coverage100.json";

/** @type {Map<string, string> | null} */
let pinionKoByTicker = null;

const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

const FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const CACHE_MS = 6 * 60 * 60 * 1000;
const MKT_CAP_BATCH = 50;

/** @type {{ data: object; at: number } | null} */
let cached = null;

/** @type {Record<string, string>} */
export const GICS_SECTOR_KO = {
  "Information Technology": "정보기술",
  "Health Care": "헬스케어",
  Financials: "금융",
  "Consumer Discretionary": "임의소비재",
  "Communication Services": "커뮤니케이션",
  Industrials: "산업재",
  "Consumer Staples": "필수소비재",
  Energy: "에너지",
  Utilities: "유틸리티",
  "Real Estate": "부동산",
  Materials: "소재",
};

function yahooSymbol(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * @param {string} csvText
 */
function parseSp500CsvWithSectors(csvText) {
  const lines = String(csvText ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name) => header.indexOf(name);
  const symIdx = idx("symbol");
  const secIdx = idx("security");
  const sectorIdx = idx("gics sector");
  const subIdx = idx("gics sub-industry");
  const hqIdx = idx("headquarters location");
  const addedIdx = idx("date added");

  /** @type {Array<object>} */
  const companies = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const rawSym = cols[symIdx >= 0 ? symIdx : 0] ?? "";
    const symbol = yahooSymbol(rawSym);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const sector = cols[sectorIdx >= 0 ? sectorIdx : 2] ?? "Unknown";
    companies.push({
      symbol,
      name: cols[secIdx >= 0 ? secIdx : 1] ?? symbol,
      nameKo: getKoreanStockName(symbol) ?? null,
      sector,
      sectorKo: GICS_SECTOR_KO[sector] ?? sector,
      subIndustry: cols[subIdx >= 0 ? subIdx : 3] ?? "",
      headquarters: cols[hqIdx >= 0 ? hqIdx : 4] ?? "",
      dateAdded: cols[addedIdx >= 0 ? addedIdx : 5] ?? "",
      marketCap: null,
    });
  }
  return companies;
}

/** @returns {Promise<Map<string, string>>} */
async function loadPinionKoByTicker() {
  if (pinionKoByTicker) return pinionKoByTicker;
  /** @type {Map<string, string>} */
  const map = new Map();
  try {
    const res = await fetch(PINION_KO_MAP_URL, {
      headers: { "User-Agent": FETCH_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const [ticker, row] of Object.entries(data ?? {})) {
        const ko = String(row?.name_ko ?? "").trim();
        if (ko && hasHangul(ko)) map.set(String(ticker).toUpperCase(), ko);
      }
    }
  } catch {
    /* offline — names-ko-sp500.json 정적 맵만 사용 */
  }
  pinionKoByTicker = map;
  return map;
}

/**
 * @param {Array<{ symbol: string; nameKo: string | null }>} companies
 */
async function enrichSp500KoreanNames(companies) {
  const pinion = await loadPinionKoByTicker();
  const missing = companies
    .filter((c) => !c.nameKo || !hasHangul(c.nameKo))
    .map((c) => c.symbol);
  const naverMap = missing.length
    ? await resolveUsKoreanStockNamesBatch(missing, 10)
    : new Map();

  for (const c of companies) {
    if (c.nameKo && hasHangul(c.nameKo)) continue;
    const sym = c.symbol;
    const dotSym = sym.replace(/-/g, ".");
    const ko =
      getKoreanStockName(sym) ??
      naverMap.get(sym) ??
      pinion.get(sym) ??
      pinion.get(dotSym) ??
      null;
    if (ko && hasHangul(ko)) c.nameKo = ko;
  }
}

/**
 * @param {string[]} symbols
 * @returns {Promise<Map<string, number>>}
 */
async function fetchUsMarketCapsBatch(symbols) {
  const list = (Array.isArray(symbols) ? symbols : [])
    .map((s) => String(s ?? "").trim().toUpperCase())
    .filter(Boolean);
  /** @type {Map<string, number>} */
  const out = new Map();
  if (!list.length) return out;
  try {
    const data = await yahooGet(
      `/v7/finance/quote?symbols=${list.map((s) => encodeURIComponent(s)).join(",")}`,
    );
    const rows = Array.isArray(data?.quoteResponse?.result)
      ? data.quoteResponse.result
      : [];
    for (const row of rows) {
      const sym = String(row?.symbol ?? "")
        .trim()
        .toUpperCase();
      const cap = Number(row?.marketCap);
      if (sym && Number.isFinite(cap) && cap > 0) out.set(sym, cap);
    }
  } catch {
    /* batch 실패 — 해당 청크는 null 유지 */
  }
  return out;
}

/**
 * @param {Array<{ symbol: string; marketCap: number | null }>} companies
 */
async function enrichSp500MarketCaps(companies) {
  const symbols = companies.map((c) => c.symbol);
  for (let i = 0; i < symbols.length; i += MKT_CAP_BATCH) {
    const chunk = symbols.slice(i, i + MKT_CAP_BATCH);
    const caps = await fetchUsMarketCapsBatch(chunk);
    const chunkSet = new Set(chunk);
    for (const c of companies) {
      if (!chunkSet.has(c.symbol)) continue;
      const cap = caps.get(c.symbol);
      if (cap != null) c.marketCap = cap;
    }
  }
}

/**
 * @param {Array<{ sector: string; sectorKo: string }>} companies
 */
function buildSectorSummary(companies) {
  const total = companies.length;
  /** @type {Map<string, { sector: string; sectorKo: string; count: number; pct: number }>} */
  const map = new Map();
  for (const c of companies) {
    const key = c.sector;
    const row = map.get(key) ?? {
      sector: c.sector,
      sectorKo: c.sectorKo,
      count: 0,
      pct: 0,
    };
    row.count += 1;
    map.set(key, row);
  }
  const sectors = [...map.values()]
    .map((s) => ({
      ...s,
      pct: total > 0 ? (s.count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
  return { total, sectors };
}

export async function fetchSp500SectorsPayload() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.data;
  }

  const res = await fetch(SP500_CSV_URL, {
    headers: { "User-Agent": FETCH_UA },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`S&P 500 CSV HTTP ${res.status}`);
  const text = await res.text();
  const companies = parseSp500CsvWithSectors(text);
  if (companies.length < 400) {
    throw new Error(`S&P 500 구성종목 수 부족 (${companies.length})`);
  }
  await enrichSp500KoreanNames(companies);
  await enrichSp500MarketCaps(companies);

  const summary = buildSectorSummary(companies);
  const payload = {
    updatedAt: Date.now(),
    weightBasis: "count",
    weightBasisLabel: "종목 수 기준 (각 종목 동일 가중)",
    ...summary,
    companies,
  };
  cached = { data: payload, at: Date.now() };
  return payload;
}
