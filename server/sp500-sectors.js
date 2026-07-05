/**
 * S&P 500 GICS 섹터·종목 (datasets/s-and-p-500-companies CSV).
 */
const SP500_CSV_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv";

const FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const CACHE_MS = 6 * 60 * 60 * 1000;

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
      sector,
      sectorKo: GICS_SECTOR_KO[sector] ?? sector,
      subIndustry: cols[subIdx >= 0 ? subIdx : 3] ?? "",
      headquarters: cols[hqIdx >= 0 ? hqIdx : 4] ?? "",
      dateAdded: cols[addedIdx >= 0 ? addedIdx : 5] ?? "",
    });
  }
  return companies;
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
