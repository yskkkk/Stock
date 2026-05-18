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
 * 주목 섹터(설정 JSON) 심볼의 **다가오는 실적 발표** — Yahoo Finance quoteSummary.
 * 캐시(기본 20분)로 호출 수를 제한합니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wallTimeToUtcMs } from "./macro-events.js";
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
 * @param {unknown} entry
 * @param {string} defaultTz
 * @returns {number | null}
 */
function coerceEarningsTimestamp(entry, defaultTz) {
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
 * @param {string} symbol
 * @param {string} listingTz
 * @returns {{ at: number; name: string } | null}
 */
function parseNextEarningsFromQuoteSummary(data, symbol, listingTz) {
  const root = /** @type {Record<string, unknown>} */ (data ?? {});
  const qs = root.quoteSummary;
  if (!qs || typeof qs !== "object") return null;
  const results = /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (qs).result);
  if (!Array.isArray(results) || results.length === 0) return null;
  const r0 = /** @type {Record<string, unknown>} */ (results[0]);
  const price = r0.price && typeof r0.price === "object" ? /** @type {Record<string, unknown>} */ (r0.price) : null;
  const name =
    (price && typeof price.longName === "string" && price.longName.trim()) ||
    (price && typeof price.shortName === "string" && price.shortName.trim()) ||
    symbol;

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
  /** @type {SectorEarningsItem[]} */
  const out = [];

  for (const row of rows) {
    const { symbol, sectorLabel, sectorId } = row;
    const listingTz = listingTimezone(symbol);
    const market = marketFromSymbol(symbol);
    const enc = encodeURIComponent(symbol);
    const pathStr = `/v10/finance/quoteSummary/${enc}?modules=calendarEvents%2Cprice`;

    try {
      const data = await queueYahooRequest(() => yahooGet(pathStr));
      const parsed = parseNextEarningsFromQuoteSummary(data, symbol, listingTz);
      if (!parsed) continue;
      const { at, name } = parsed;
      if (at < now - 12 * 3600 * 1000 || at > horizon) continue;
      out.push({
        id: `${sectorId}:${symbol}:${at}`,
        sectorId,
        sectorLabel,
        symbol,
        name,
        market,
        at,
        timezone: listingTz,
      });
    } catch {
      /* 심볼별 실패는 건너뜀 */
    }
  }

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
