/**
 * SEC EDGAR — 미국 종목 최근 공시 (8-K / DEF 14A 등)
 */
import { liveTradeLogWarn } from "./live-trade-log.js";

const SEC_UA =
  String(process.env.SEC_USER_AGENT ?? "").trim() ||
  "YSTOCK AnnouncementInbox contact@ystock.local";

/** @type {{ at: number; map: Map<string, string> } | null} */
let tickerCikCache = null;
const TICKER_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} pathOrUrl
 */
async function secGetJson(pathOrUrl) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://data.sec.gov${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": SEC_UA,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const err = new Error(`SEC HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * @returns {Promise<Map<string, string>>} ticker → CIK zero-padded 10
 */
export async function loadSecTickerCikMap() {
  if (tickerCikCache && Date.now() - tickerCikCache.at < TICKER_CACHE_MS) {
    return tickerCikCache.map;
  }
  const data = await secGetJson("https://www.sec.gov/files/company_tickers.json");
  /** @type {Map<string, string>} */
  const map = new Map();
  if (data && typeof data === "object") {
    for (const row of Object.values(data)) {
      if (!row || typeof row !== "object") continue;
      const t = String(/** @type {Record<string, unknown>} */ (row).ticker ?? "")
        .trim()
        .toUpperCase();
      const cik = Number(/** @type {Record<string, unknown>} */ (row).cik_str);
      if (!t || !Number.isFinite(cik)) continue;
      map.set(t, String(Math.trunc(cik)).padStart(10, "0"));
    }
  }
  tickerCikCache = { at: Date.now(), map };
  return map;
}

/**
 * @param {string} symbol
 * @returns {Promise<string | null>}
 */
export async function resolveSecCikForSymbol(symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return null;
  const map = await loadSecTickerCikMap();
  return map.get(sym) ?? null;
}

/**
 * @param {string} form
 * @returns {"guidance"|"governance"|"earnings"|null}
 */
export function classifySecForm(form) {
  const f = String(form ?? "")
    .trim()
    .toUpperCase();
  if (!f) return null;
  if (f === "DEF 14A" || f === "DEFA14A" || f.startsWith("DEF 14")) {
    return "governance";
  }
  // Form 3/4/5 내부자 매매는 인박스 중복만 키우므로 제외(알림도 하지 않음)
  if (f === "4" || f === "3" || f === "5") return null;
  if (f === "8-K" || f === "8-K/A") return "guidance";
  if (f === "10-Q" || f === "10-K" || f === "10-Q/A" || f === "10-K/A") {
    return "earnings";
  }
  return null;
}

/**
 * @param {string} cik
 * @param {string} accession
 * @param {string} primaryDocument
 */
export function buildEdgarDocumentUrl(cik, accession, primaryDocument) {
  const cikNum = String(Number(cik));
  const acc = String(accession ?? "").replace(/-/g, "");
  const doc = String(primaryDocument ?? "").trim();
  if (!cikNum || !acc) {
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`;
  }
  if (doc) {
    return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${doc}`;
  }
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/`;
}

/**
 * @param {string} symbol
 * @param {{ limit?: number; sinceMs?: number }} [opts]
 */
export async function fetchRecentSecFilingsForSymbol(symbol, opts = {}) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const limit = Math.min(80, Math.max(1, Number(opts.limit) || 12));
  const sinceMs =
    Number(opts.sinceMs) || Date.now() - 14 * 24 * 60 * 60 * 1000;

  const cik = await resolveSecCikForSymbol(sym);
  if (!cik) return { symbol: sym, cik: null, filings: [] };

  try {
    const data = await secGetJson(`/submissions/CIK${cik}.json`);
    const recent = data?.filings?.recent;
    if (!recent || typeof recent !== "object") {
      return { symbol: sym, cik, filings: [] };
    }
    const forms = Array.isArray(recent.form) ? recent.form : [];
    const dates = Array.isArray(recent.filingDate) ? recent.filingDate : [];
    const accessions = Array.isArray(recent.accessionNumber)
      ? recent.accessionNumber
      : [];
    const primaries = Array.isArray(recent.primaryDocument)
      ? recent.primaryDocument
      : [];
    const descriptions = Array.isArray(recent.primaryDocDescription)
      ? recent.primaryDocDescription
      : [];

    /** @type {Array<{
     *   form: string;
     *   filedAt: number;
     *   accession: string;
     *   title: string;
     *   kind: "guidance"|"governance"|"earnings";
     *   url: string;
     * }>} */
    const filings = [];
    for (let i = 0; i < forms.length && filings.length < limit; i++) {
      const form = String(forms[i] ?? "");
      const kind = classifySecForm(form);
      if (!kind) continue;
      const dateStr = String(dates[i] ?? "");
      const filedAt = Date.parse(`${dateStr}T16:00:00-04:00`);
      if (!Number.isFinite(filedAt) || filedAt < sinceMs) continue;
      const accession = String(accessions[i] ?? "");
      const primary = String(primaries[i] ?? "");
      const desc = String(descriptions[i] ?? "").trim();
      filings.push({
        form,
        filedAt,
        accession,
        title: desc || `${sym} ${form}`,
        kind,
        url: buildEdgarDocumentUrl(cik, accession, primary),
      });
    }
    return { symbol: sym, cik, filings };
  } catch (e) {
    liveTradeLogWarn(
      "[us-announcement] EDGAR fetch fail",
      sym,
      e instanceof Error ? e.message : e,
    );
    return { symbol: sym, cik, filings: [] };
  }
}
