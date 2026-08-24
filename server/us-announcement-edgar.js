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

const ALL_HISTORY_FILING_LIMIT = 100_000;
const SEC_ARCHIVE_FILE_RE = /^CIK\d+-submissions-\d+\.json$/i;

/**
 * @param {unknown} bucket
 */
function filingArraysFromBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  const rec = /** @type {Record<string, unknown>} */ (bucket);
  if (Array.isArray(rec.form)) return rec;
  const nestedRecent = rec.recent;
  if (
    nestedRecent &&
    typeof nestedRecent === "object" &&
    Array.isArray(/** @type {Record<string, unknown>} */ (nestedRecent).form)
  ) {
    return /** @type {Record<string, unknown>} */ (nestedRecent);
  }
  const filings = rec.filings;
  if (filings && typeof filings === "object") {
    const recent = /** @type {Record<string, unknown>} */ (filings).recent;
    if (
      recent &&
      typeof recent === "object" &&
      Array.isArray(/** @type {Record<string, unknown>} */ (recent).form)
    ) {
      return /** @type {Record<string, unknown>} */ (recent);
    }
  }
  return null;
}

/**
 * submissions recent / 아카이브 JSON에서 분류된 공시만 수집.
 * @param {unknown} bucket
 * @param {{
 *   cik: string;
 *   symbol: string;
 *   sinceMs?: number;
 *   limit?: number;
 *   seenAccessions?: Set<string>;
 * }} ctx
 */
export function collectClassifiedFilingsFromBucket(bucket, ctx) {
  const arrays = filingArraysFromBucket(bucket);
  const cik = String(ctx.cik ?? "");
  const symbol = String(ctx.symbol ?? "")
    .trim()
    .toUpperCase();
  const sinceMs = Number.isFinite(Number(ctx.sinceMs)) ? Number(ctx.sinceMs) : 0;
  const limit = Math.max(0, Number(ctx.limit) || 0);
  const seen = ctx.seenAccessions instanceof Set ? ctx.seenAccessions : new Set();
  if (!arrays || !cik || limit <= 0) return [];

  const forms = Array.isArray(arrays.form) ? arrays.form : [];
  const dates = Array.isArray(arrays.filingDate) ? arrays.filingDate : [];
  const accessions = Array.isArray(arrays.accessionNumber)
    ? arrays.accessionNumber
    : [];
  const primaries = Array.isArray(arrays.primaryDocument)
    ? arrays.primaryDocument
    : [];
  const descriptions = Array.isArray(arrays.primaryDocDescription)
    ? arrays.primaryDocDescription
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
    const accession = String(accessions[i] ?? "").trim();
    if (accession && seen.has(accession)) continue;
    if (accession) seen.add(accession);
    const primary = String(primaries[i] ?? "");
    const desc = String(descriptions[i] ?? "").trim();
    filings.push({
      form,
      filedAt,
      accession,
      title: desc || `${symbol} ${form}`,
      kind,
      url: buildEdgarDocumentUrl(cik, accession, primary),
    });
  }
  return filings;
}

/**
 * @param {number} ms
 */
function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {unknown} sinceMs
 * @param {boolean} allHistory
 */
function resolveFilingSinceMs(sinceMs, allHistory) {
  if (allHistory) {
    if (sinceMs == null || sinceMs === "") return 0;
    const n = Number(sinceMs);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(sinceMs);
  if (Number.isFinite(n) && n > 0) return n;
  return Date.now() - 14 * 24 * 60 * 60 * 1000;
}

/**
 * @param {string} symbol
 * @param {{ limit?: number; sinceMs?: number; allHistory?: boolean }} [opts]
 */
export async function fetchRecentSecFilingsForSymbol(symbol, opts = {}) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const allHistory = opts.allHistory === true;
  const limit = allHistory
    ? Math.min(
        ALL_HISTORY_FILING_LIMIT,
        Math.max(1, Number(opts.limit) || ALL_HISTORY_FILING_LIMIT),
      )
    : Math.min(80, Math.max(1, Number(opts.limit) || 12));
  const sinceMs = resolveFilingSinceMs(opts.sinceMs, allHistory);

  const cik = await resolveSecCikForSymbol(sym);
  if (!cik) return { symbol: sym, cik: null, filings: [] };

  try {
    const data = await secGetJson(`/submissions/CIK${cik}.json`);
    /** @type {Set<string>} */
    const seenAccessions = new Set();
    const filings = collectClassifiedFilingsFromBucket(data?.filings?.recent, {
      cik,
      symbol: sym,
      sinceMs,
      limit,
      seenAccessions,
    });

    if (allHistory && filings.length < limit) {
      const files = Array.isArray(data?.filings?.files) ? data.filings.files : [];
      for (const file of files) {
        if (filings.length >= limit) break;
        const name = String(file?.name ?? "").trim();
        if (!SEC_ARCHIVE_FILE_RE.test(name)) continue;
        await sleepMs(120);
        try {
          const extra = await secGetJson(
            `https://data.sec.gov/submissions/${encodeURIComponent(name)}`,
          );
          filings.push(
            ...collectClassifiedFilingsFromBucket(extra, {
              cik,
              symbol: sym,
              sinceMs,
              limit: limit - filings.length,
              seenAccessions,
            }),
          );
        } catch (e) {
          liveTradeLogWarn(
            "[us-announcement] EDGAR archive fetch fail",
            sym,
            name,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    filings.sort((a, b) => Number(b.filedAt) - Number(a.filedAt));
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
