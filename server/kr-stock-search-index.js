/**
 * 국내 종목 검색 보강 — KRX 전체 상장 목록(이름·코드) + 네이버 자동완성
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { registerKoreanName, resolveDisplayName } from "./names-ko.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KRX_LIST_CSV_URL =
  "https://raw.githubusercontent.com/dalinaum/rs/main/krx-list.csv";
const NAVER_AC_URL = "https://ac.finance.naver.com/ac";
const FETCH_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const INDEX_TTL_MS = 24 * 60 * 60_000;

/** @type {{ at: number; rows: KrSearchRow[] } | null} */
let indexCache = null;
/** @type {Promise<KrSearchRow[]> | null} */
let indexPromise = null;
/** @type {Map<string, "KS" | "KQ">} */
const codeSuffixCache = new Map();

/**
 * @typedef {{ symbol: string; name: string; code: string; suffix: "KS" | "KQ" }} KrSearchRow
 */

function normalizeKrQuery(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * @param {string} text
 * @returns {KrSearchRow[]}
 */
export function parseKrxListCsvAll(text) {
  const lines = String(text ?? "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const codeIdx = header.indexOf("Code");
  const nameIdx = header.indexOf("Name");
  const marketIdx = header.indexOf("Market");
  if (codeIdx < 0 || nameIdx < 0) return [];

  /** @type {KrSearchRow[]} */
  const rows = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const code = String(p[codeIdx] ?? "").trim().padStart(6, "0");
    if (!/^\d{6}$/.test(code)) continue;
    const market = String(p[marketIdx] ?? "").trim().toUpperCase();
    const suffix =
      market.includes("KOSDAQ") || market === "KQ" ? "KQ" : "KS";
    const sym = `${code}.${suffix}`;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const name = resolveDisplayName(sym, String(p[nameIdx] ?? sym).trim(), sym);
    codeSuffixCache.set(code, suffix);
    rows.push({ symbol: sym, name, code, suffix });
  }
  return rows;
}

function loadKrxFallbackRows() {
  try {
    const raw = readFileSync(join(__dirname, "data", "universe-kr.json"), "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((row) => {
        const sym = String(row?.symbol ?? "").trim().toUpperCase();
        const m = sym.match(/^(\d{6})\.(KS|KQ)$/);
        if (!m) return null;
        const code = m[1];
        const suffix = m[2] === "KQ" ? "KQ" : "KS";
        codeSuffixCache.set(code, suffix);
        return {
          symbol: sym,
          name: String(row?.name ?? sym),
          code,
          suffix,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchKrxRowsRemote() {
  try {
    const res = await fetch(KRX_LIST_CSV_URL, {
      headers: { "User-Agent": FETCH_UA },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`KRX list HTTP ${res.status}`);
    const parsed = parseKrxListCsvAll(await res.text());
    if (parsed.length < 500) {
      throw new Error(`KRX 목록 수 부족 (${parsed.length})`);
    }
    return parsed;
  } catch (e) {
    console.warn(
      "[kr-search] KRX CSV:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

export async function ensureKrSearchIndex() {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) {
    return indexCache.rows;
  }
  if (!indexPromise) {
    indexPromise = (async () => {
      let rows = await fetchKrxRowsRemote();
      if (rows.length < 500) {
        rows = loadKrxFallbackRows();
      }
      indexCache = { at: Date.now(), rows };
      return rows;
    })().finally(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/**
 * @param {string} code
 * @returns {"KS" | "KQ"}
 */
export function krSuffixForCode(code) {
  const c = String(code ?? "").trim().padStart(6, "0");
  return codeSuffixCache.get(c) ?? "KS";
}

/**
 * @param {string} code
 * @returns {string}
 */
export function krYahooSymbolFromCode(code) {
  const c = String(code ?? "").trim().padStart(6, "0");
  if (!/^\d{6}$/.test(c)) return "";
  return `${c}.${krSuffixForCode(c)}`;
}

/**
 * @param {string} query
 * @param {number} [limit]
 */
export function searchKrStockIndexRows(rows, query, limit = 20) {
  const t = String(query ?? "").trim();
  if (!t || !rows.length) return [];
  const qLower = t.toLowerCase();
  const qCompact = normalizeKrQuery(t);
  const digits = t.replace(/\D/g, "");

  /** @type {Array<KrSearchRow & { score: number }>} */
  const scored = [];

  for (const row of rows) {
    const name = String(row.name ?? "");
    const nameLower = name.toLowerCase();
    const nameCompact = normalizeKrQuery(name);
    const sym = row.symbol;
    const code = row.code;

    let score = 0;
    if (digits.length >= 4) {
      if (code === digits.padStart(6, "0")) score = 120;
      else if (code.includes(digits)) score = 100;
      else if (sym.includes(digits)) score = 90;
    }
    if (score <= 0) {
      if (name === t || nameCompact === qCompact) score = 95;
      else if (nameLower === qLower) score = 94;
      else if (name.startsWith(t) || nameCompact.startsWith(qCompact)) score = 80;
      else if (name.includes(t) || nameCompact.includes(qCompact)) score = 60;
      else if (nameLower.includes(qLower)) score = 55;
      else if (sym.toLowerCase().includes(qLower)) score = 40;
    }
    if (score <= 0) continue;
    scored.push({ ...row, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.name.localeCompare(b.name, "ko", { sensitivity: "base" }),
  );
  return scored.slice(0, Math.max(1, limit));
}

/**
 * @param {unknown} payload
 * @returns {KrSearchRow[]}
 */
export function parseNaverAcStockPayload(payload) {
  /** @type {KrSearchRow[]} */
  const out = [];
  const seen = new Set();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const item of items) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const entries = Array.isArray(item[1]) ? item[1] : [];
    for (const entry of entries) {
      const row = Array.isArray(entry) ? entry : [];
      const name = String(row[0] ?? item[0] ?? "").trim();
      const code = String(row[1] ?? "").trim().padStart(6, "0");
      if (!/^\d{6}$/.test(code) || !name) continue;
      const sym = krYahooSymbolFromCode(code);
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      out.push({
        symbol: sym,
        name: resolveDisplayName(sym, name, sym),
        code,
        suffix: krSuffixForCode(code),
      });
    }
  }
  return out;
}

/**
 * @param {string} query
 */
async function fetchKrNaverAutocomplete(query) {
  const q = String(query ?? "").trim();
  if (!q) return [];
  try {
    const url = `${NAVER_AC_URL}?q=${encodeURIComponent(q)}&t=stock&st=111`;
    const res = await fetch(url, {
      headers: { "User-Agent": FETCH_UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const json = JSON.parse(text);
    return parseNaverAcStockPayload(json);
  } catch {
    return [];
  }
}

/**
 * @param {string} query
 * @param {Set<string>} seen
 * @param {object[]} out
 */
export async function appendKrExtendedSearchMatches(query, seen, out) {
  const q = String(query ?? "").trim();
  if (!q) return;

  const rows = await ensureKrSearchIndex();
  const indexHits = searchKrStockIndexRows(rows, q, 20);
  for (const hit of indexHits) {
    if (out.length >= 28) break;
    if (seen.has(hit.symbol)) continue;
    seen.add(hit.symbol);
    registerKoreanName(hit.symbol, hit.name);
    out.push({
      symbol: hit.symbol,
      name: hit.name,
      market: "kr",
      quoteType: "EQUITY",
    });
  }

  if (out.length >= 8) return;

  const byCode = new Map(rows.map((row) => [row.code, row]));
  const naverHits = await fetchKrNaverAutocomplete(q);
  for (const hit of naverHits) {
    if (out.length >= 28) break;
    const indexed = byCode.get(hit.code);
    const symbol = indexed?.symbol ?? hit.symbol;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const name = indexed?.name ?? hit.name;
    registerKoreanName(symbol, name);
    out.push({
      symbol,
      name,
      market: "kr",
      quoteType: "EQUITY",
    });
  }
}
