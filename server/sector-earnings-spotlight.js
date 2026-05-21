/**
 * @typedef {Object} SectorEarningsItem
 * @property {string} id
 * @property {string} sectorId
 * @property {string} sectorLabel
 * @property {string} symbol
 * @property {string} name
 * @property {"kr"|"us"} market
 * @property {number} at
 * @property {string} timezone
 */

/**
 * 주목 섹터(`data/sector-earnings-spotlight.json`) 심볼의 다가오는 실적.
 * - `FINNHUB_API_KEY`가 있으면 Finnhub 실적 캘린더(우선).
 * - 없으면 Yahoo `quoteSummary` calendarEvents(세션·지역에 따라 실패할 수 있음).
 * 캐시 기본 20분.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wallTimeToUtcMs } from "./macro-events.js";
import { resolveDisplayName } from "./names-ko.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "data", "sector-earnings-spotlight.json");

const CACHE_MS = Number(process.env.SECTOR_EARNINGS_CACHE_MS) > 60_000
  ? Math.min(6 * 60 * 60_000, Math.floor(Number(process.env.SECTOR_EARNINGS_CACHE_MS)))
  : 20 * 60_000;
const HORIZON_DAYS = Number(process.env.SECTOR_EARNINGS_HORIZON_DAYS) > 0
  ? Math.min(45, Math.floor(Number(process.env.SECTOR_EARNINGS_HORIZON_DAYS)))
  : 21;
const MAX_ITEMS = Number(process.env.SECTOR_EARNINGS_MAX) > 0
  ? Math.min(24, Math.floor(Number(process.env.SECTOR_EARNINGS_MAX)))
  : 12;
const CONCURRENCY = (() => {
  const n = Number(process.env.SECTOR_EARNINGS_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, Math.floor(n)) : 4;
})();

/** Finnhub 무료 구간과 맞추기 위해 상한(일) */
const FINNHUB_TO_MAX_DAYS = 28;
const FINNHUB_EARNINGS_TTL_MS = 30 * 60_000;

/** @type {{ key: string; at: number; rows: unknown[] }} */
let finnhubEarningsCache = { key: "", at: 0, rows: [] };
/** @type {Promise<unknown[]> | null} */
let finnhubEarningsInflight = null;

/** @type {{ at: number; items: SectorEarningsItem[] } | null} */
let cache = null;
/** @type {Promise<SectorEarningsItem[]> | null} */
let inflight = null;

/** @param {string} sym */
function listingTimezone(sym) {
  const s = String(sym ?? "").trim().toUpperCase();
  if (/\.(KS|KQ)$/.test(s)) return "Asia/Seoul";
  return "America/New_York";
}

/** @param {string} sym */
function marketFromSymbol(sym) {
  return /\.(KS|KQ)$/i.test(String(sym ?? "").trim()) ? "kr" : "us";
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<unknown>} fn
 */
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function utcYmd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {unknown} entry
 * @param {string} defaultTz
 * @returns {number | null}
 */
function coerceEarningsTimestamp(entry, defaultTz) {
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return entry < 1e12 ? entry * 1000 : entry;
  }
  if (entry == null || typeof entry !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (entry);
  const raw = o.raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const fmt = o.fmt;
  if (typeof fmt === "string" && /^\d{4}-\d{2}-\d{2}/.test(fmt)) {
    const m = fmt.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    try {
      return wallTimeToUtcMs(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0, defaultTz);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown> | null}
 */
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

/**
 * @param {unknown} data
 * @param {string} symbol
 * @param {string} listingTz
 * @returns {{ at: number; name: string } | null}
 */
function parseNextEarningsFromQuoteSummary(data, symbol, listingTz) {
  const r0 = quoteSummaryFirstResult(data);
  if (!r0) return null;
  const price = r0.price && typeof r0.price === "object" ? /** @type {Record<string, unknown>} */ (r0.price) : null;
  const name =
    (price && typeof price.longName === "string" && price.longName.trim()) ||
    (price && typeof price.shortName === "string" && price.shortName.trim()) ||
    resolveDisplayName(symbol);

  const cal = r0.calendarEvents && typeof r0.calendarEvents === "object"
    ? /** @type {Record<string, unknown>} */ (r0.calendarEvents)
    : null;
  const earn = cal?.earnings && typeof cal.earnings === "object"
    ? /** @type {Record<string, unknown>} */ (cal.earnings)
    : null;
  if (!earn) return null;

  /** @type {number[]} */
  const candidates = [];
  const pushEntry = (x) => {
    const ms = coerceEarningsTimestamp(x, listingTz);
    if (ms != null && Number.isFinite(ms)) candidates.push(ms);
  };

  const ed = earn.earningsDate;
  if (Array.isArray(ed)) for (const x of ed) pushEntry(x);
  else if (ed && typeof ed === "object") pushEntry(ed);

  const rd = earn.revenueDate;
  if (Array.isArray(rd)) for (const x of rd) pushEntry(x);
  else if (rd && typeof rd === "object") pushEntry(rd);

  if (candidates.length === 0) return null;
  const at = Math.min(...candidates);
  return { at, name: String(name) };
}

/**
 * @param {string} dateStr
 * @param {string} listingTz
 */
function finnhubDateToUtcMs(dateStr, listingTz) {
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  try {
    return wallTimeToUtcMs(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0, listingTz);
  } catch {
    return null;
  }
}

/**
 * @param {string} fromYmd
 * @param {string} toYmd
 * @param {string} token
 * @param {boolean} needInternational
 */
async function loadFinnhubEarningsBulkRows(fromYmd, toYmd, token, needInternational) {
  const cacheKey = `${token}:${fromYmd}:${toYmd}:${needInternational ? 1 : 0}`;
  const now = Date.now();
  if (finnhubEarningsCache.key === cacheKey && now - finnhubEarningsCache.at < FINNHUB_EARNINGS_TTL_MS) {
    return finnhubEarningsCache.rows;
  }
  if (finnhubEarningsInflight) {
    return finnhubEarningsInflight;
  }

  finnhubEarningsInflight = (async () => {
    async function fetchOne(international) {
      const intl = international ? "&international=true" : "";
      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(fromYmd)}&to=${encodeURIComponent(toYmd)}${intl}&token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Finnhub earnings ${res.status}`);
      const data = await res.json().catch(() => null);
      return Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
    }
    const parts = await Promise.all([
      fetchOne(false),
      ...(needInternational ? [fetchOne(true)] : []),
    ]);
    const rows = parts.flat();
    finnhubEarningsCache = { key: cacheKey, at: Date.now(), rows };
    return rows;
  })();

  try {
    return await finnhubEarningsInflight;
  } finally {
    finnhubEarningsInflight = null;
  }
}

/**
 * @param {unknown[]} rows
 * @param {string} symbol
 * @param {string} listingTz
 * @param {number} now
 * @param {number} horizon
 */
function nextEarningMsFromBulk(rows, symbol, listingTz, now, horizon) {
  const symU = symbol.trim().toUpperCase();
  let best = /** @type {number | null} */ (null);
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const s = String(/** @type {Record<string, unknown>} */ (row).symbol ?? "")
      .trim()
      .toUpperCase();
    if (s !== symU) continue;
    const dateStr = /** @type {Record<string, unknown>} */ (row).date;
    if (typeof dateStr !== "string" || !dateStr) continue;
    const at = finnhubDateToUtcMs(dateStr, listingTz);
    if (at == null || !Number.isFinite(at)) continue;
    if (at < now - 12 * 3600 * 1000 || at > horizon) continue;
    if (best == null || at < best) best = at;
  }
  return best;
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const sectors = Array.isArray(parsed.sectors) ? parsed.sectors : [];
  /** @type {{ sectorId: string; sectorLabel: string; symbol: string }[]} */
  const flat = [];
  for (const s of sectors) {
    if (!s || typeof s !== "object") continue;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    const label = typeof s.label === "string" ? s.label.trim() : "";
    const syms = Array.isArray(s.symbols) ? s.symbols : [];
    if (!id || !label) continue;
    for (const sym of syms) {
      const symbol = String(sym ?? "").trim();
      if (!symbol) continue;
      flat.push({ sectorId: id, sectorLabel: label, symbol });
    }
  }
  return flat;
}

/**
 * @returns {Promise<SectorEarningsItem[]>}
 */
async function fetchFreshSectorEarnings() {
  let rows;
  try {
    rows = loadConfig();
  } catch {
    return [];
  }
  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 86400000;
  const apiKey = String(process.env.FINNHUB_API_KEY ?? "").trim();
  const horizonForFinnhub = Math.min(HORIZON_DAYS, FINNHUB_TO_MAX_DAYS);
  const fromYmd = utcYmd(now);
  const toYmd = utcYmd(now + horizonForFinnhub * 86400000);

  const hasKr = rows.some((r) => marketFromSymbol(r.symbol) === "kr");
  /** @type {unknown[]} */
  let bulkRows = [];
  if (apiKey) {
    try {
      bulkRows = await loadFinnhubEarningsBulkRows(fromYmd, toYmd, apiKey, hasKr);
    } catch {
      bulkRows = [];
    }
  }

  /** @param {{ sectorId: string; sectorLabel: string; symbol: string }} row */
  async function resolveOne(row) {
    const { symbol, sectorLabel, sectorId } = row;
    const listingTz = listingTimezone(symbol);
    const market = marketFromSymbol(symbol);

    /** @type {{ at: number; name: string } | null} */
    let parsed = null;

    if (apiKey && bulkRows.length) {
      const at = nextEarningMsFromBulk(bulkRows, symbol, listingTz, now, horizon);
      if (at != null && Number.isFinite(at)) {
        parsed = { at, name: resolveDisplayName(symbol) };
      }
    }

    if (!parsed) {
      const enc = encodeURIComponent(symbol);
      const pathStr = `/v10/finance/quoteSummary/${enc}?modules=calendarEvents%2Cprice`;
      try {
        const data = await queueYahooRequest(() => yahooGet(pathStr));
        parsed = parseNextEarningsFromQuoteSummary(data, symbol, listingTz);
      } catch {
        parsed = null;
      }
    }

    if (!parsed) return null;
    const { at, name } = parsed;
    if (at < now - 12 * 3600 * 1000 || at > horizon) return null;
    return {
      id: `${sectorId}:${symbol}:${at}`,
      sectorId,
      sectorLabel,
      symbol,
      name,
      market,
      at,
      timezone: listingTz,
    };
  }

  const resolved = await mapConcurrent(rows, CONCURRENCY, resolveOne);
  /** @type {SectorEarningsItem[]} */
  const out = resolved.filter((x) => x != null);

  out.sort((a, b) => a.at - b.at);
  const seen = new Set();
  const dedup = [];
  for (const e of out) {
    if (seen.has(e.symbol)) continue;
    seen.add(e.symbol);
    dedup.push(e);
    if (dedup.length >= MAX_ITEMS) break;
  }
  return dedup;
}

/**
 * @returns {Promise<SectorEarningsItem[]>}
 */
export async function fetchSectorEarningsSpotlight() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return cache.items;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const items = await fetchFreshSectorEarnings();
      cache = { at: Date.now(), items };
      return items;
    } catch {
      cache = { at: Date.now(), items: cache?.items ?? [] };
      return cache.items;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function prewarmSectorEarningsCache() {
  void fetchSectorEarningsSpotlight();
}
