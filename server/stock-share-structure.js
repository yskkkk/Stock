/**
 * 종목 주식 수량 — 전체·대주주·유동 (디스크 캐시, KST 자정·정오 갱신)
 */
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "stock-share-structure.json";
const FNGUIDE_UA = "Mozilla/5.0 (compatible; StockApp/1.0)";

/** @param {unknown} v */
function numField(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object") {
    const raw = /** @type {{ raw?: unknown }} */ (v).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

/** @param {string} s */
function parseCommaNum(s) {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {Date} [now] */
function kstParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** KST 반일 슬롯 — 00:xx~11:xx = am, 12:xx~23:xx = pm */
export function shareStructureSlotId(now = new Date()) {
  const { dateKey, hour } = kstParts(now);
  return `${dateKey}-${hour >= 12 ? "pm" : "am"}`;
}

/**
 * @typedef {Object} ShareStructureEntry
 * @property {number | null} totalShares
 * @property {number | null} majorShareholderShares
 * @property {number | null} floatShares
 * @property {number | null} floatPct
 * @property {string | null} source
 * @property {number} fetchedAtMs
 * @property {string} fetchedAtSlot
 */

/**
 * @param {unknown} raw
 * @returns {{ entries: Record<string, ShareStructureEntry>; lastBulkRefreshSlot: string | null }}
 */
function normalizeStore(raw) {
  const entries =
    raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object"
      ? /** @type {Record<string, ShareStructureEntry>} */ (raw.entries)
      : {};
  const lastBulkRefreshSlot =
    raw && typeof raw === "object" && typeof raw.lastBulkRefreshSlot === "string"
      ? raw.lastBulkRefreshSlot
      : null;
  return { entries, lastBulkRefreshSlot };
}

function emptyStore() {
  return { entries: {}, lastBulkRefreshSlot: null };
}

function readStore() {
  return readJsonStoreSync(STORE_FILE, normalizeStore, emptyStore);
}

/** @param {ReturnType<typeof readStore>} store */
function writeStore(store) {
  writeJsonStoreSync(STORE_FILE, store);
}

/** @param {string} symbol */
function isKrSymbol(symbol) {
  const s = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/^KR_/, "");
  return /^\d{6}$/.test(s);
}

/** @param {string} symbol */
function krCode(symbol) {
  return String(symbol ?? "")
    .trim()
    .replace(/^KR_/i, "")
    .padStart(6, "0");
}

/**
 * @param {number | null} total
 * @param {number | null} floatShares
 * @param {number | null} floatPctHint
 */
function deriveFloatPct(total, floatShares, floatPctHint) {
  if (total != null && floatShares != null && total > 0) {
    return (floatShares / total) * 100;
  }
  if (floatPctHint != null && Number.isFinite(floatPctHint)) return floatPctHint;
  return null;
}

/**
 * @param {string} html
 * @returns {{ totalShares: number | null; majorShareholderShares: number | null; floatShares: number | null; floatPct: number | null } | null}
 */
function parseFnGuideShareStructure(html) {
  const totalM = html.match(
    /발행주식수<span class="csize">\(보통주\/ 우선주\)<\/span><\/div><\/th>\s*<td class="r">([\d,]+)/,
  );
  const floatM = html.match(
    /유동주식수\/비율<\/a>[\s\S]*?<td class="r">([\d,]+)\s*\/\s*([\d.]+)/,
  );
  const majorM = html.match(
    /최대주주등&nbsp;\(본인\+특별관계자\)[\s\S]*?<td class="r">\d+<\/td><td class="r">([\d,]+)<\/td><td class="r">([\d.]+)/,
  );
  const totalShares = totalM ? parseCommaNum(totalM[1]) : null;
  const floatShares = floatM ? parseCommaNum(floatM[1]) : null;
  const floatPctHint = floatM ? Number(floatM[2]) : null;
  const majorShareholderShares = majorM ? parseCommaNum(majorM[1]) : null;
  if (!totalShares && !floatShares && !majorShareholderShares) return null;
  return {
    totalShares,
    majorShareholderShares,
    floatShares,
    floatPct: deriveFloatPct(totalShares, floatShares, floatPctHint),
  };
}

/** @param {string} symbol */
async function fetchFnGuideKr(symbol) {
  const gicode = `A${krCode(symbol)}`;
  const res = await fetch(
    `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=${encodeURIComponent(gicode)}`,
    { headers: { "User-Agent": FNGUIDE_UA } },
  );
  if (!res.ok) return null;
  const html = await res.text();
  const parsed = parseFnGuideShareStructure(html);
  if (!parsed) return null;
  return { ...parsed, source: "FnGuide" };
}

/**
 * @param {string} yahooSym
 * @returns {Promise<{ totalShares: number | null; majorShareholderShares: number | null; floatShares: number | null; floatPct: number | null; source: string } | null>}
 */
async function fetchYahooOne(yahooSym) {
  const data = await queueYahooRequest(() =>
    yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(yahooSym)}?modules=defaultKeyStatistics`,
    ),
  );
  const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
  const totalShares =
    numField(stats?.sharesOutstanding) ?? numField(stats?.impliedSharesOutstanding);
  if (totalShares == null || totalShares <= 0) return null;
  const floatShares = numField(stats?.floatShares);
  const insiderPct = numField(stats?.heldPercentInsiders);
  const majorShareholderShares =
    insiderPct != null && insiderPct >= 0 ? totalShares * insiderPct : null;
  return {
    totalShares,
    majorShareholderShares,
    floatShares,
    floatPct: deriveFloatPct(totalShares, floatShares, null),
    source: `Yahoo ${yahooSym}`,
  };
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 */
async function fetchYahooShareStats(symbol, market) {
  if (market === "us") {
    return fetchYahooOne(symbol);
  }
  const code = krCode(symbol);
  for (const suffix of [".KS", ".KQ"]) {
    try {
      const hit = await fetchYahooOne(`${code}${suffix}`);
      if (hit) return hit;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 */
async function fetchLiveShareStructure(symbol, market) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const m = market === "kr" || market === "us" ? market : isKrSymbol(sym) ? "kr" : "us";

  const yahoo = await fetchYahooShareStats(sym, m).catch(() => null);
  if (m === "kr") {
    const fg = await fetchFnGuideKr(sym).catch(() => null);
    if (fg) {
      const totalShares = fg.totalShares ?? yahoo?.totalShares ?? null;
      const floatShares = fg.floatShares ?? yahoo?.floatShares ?? null;
      const majorShareholderShares =
        fg.majorShareholderShares ?? yahoo?.majorShareholderShares ?? null;
      return {
        totalShares,
        majorShareholderShares,
        floatShares,
        floatPct: deriveFloatPct(totalShares, floatShares, fg.floatPct),
        source: yahoo ? `FnGuide+${yahoo.source}` : "FnGuide",
      };
    }
    if (yahoo) return yahoo;
  } else if (yahoo) {
    return yahoo;
  }

  const err = new Error("주식 수량 데이터를 가져올 수 없습니다.");
  /** @type {Error & { code?: string }} */ (err).code = "NOT_FOUND";
  throw err;
}

/**
 * @param {string} symbol
 * @param {ShareStructureEntry} entry
 */
function toApiPayload(symbol, entry) {
  return {
    symbol,
    totalShares: entry.totalShares,
    majorShareholderShares: entry.majorShareholderShares,
    floatShares: entry.floatShares,
    floatPct: entry.floatPct,
    source: entry.source,
    fetchedAtMs: entry.fetchedAtMs,
    fetchedAtSlot: entry.fetchedAtSlot,
  };
}

/** @param {ShareStructureEntry | undefined} entry */
function isEntryFresh(entry) {
  if (!entry?.fetchedAtSlot) return false;
  return entry.fetchedAtSlot === shareStructureSlotId();
}

/**
 * @param {string} symbol
 * @param {"kr"|"us" | undefined} [market]
 */
export async function loadStockShareStructure(symbol, market) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) {
    const err = new Error("심볼이 필요합니다.");
    /** @type {Error & { code?: string }} */ (err).code = "BAD_SYMBOL";
    throw err;
  }

  const store = readStore();
  const cached = store.entries[sym];
  if (cached && isEntryFresh(cached)) {
    return toApiPayload(sym, cached);
  }

  const m =
    market === "kr" || market === "us"
      ? market
      : isKrSymbol(sym)
        ? "kr"
        : "us";
  const live = await fetchLiveShareStructure(sym, m);
  const slot = shareStructureSlotId();
  const entry = {
    totalShares: live.totalShares,
    majorShareholderShares: live.majorShareholderShares,
    floatShares: live.floatShares,
    floatPct: live.floatPct,
    source: live.source ?? null,
    fetchedAtMs: Date.now(),
    fetchedAtSlot: slot,
  };
  store.entries[sym] = entry;
  writeStore(store);
  return toApiPayload(sym, entry);
}

/** 캐시된 모든 심볼 일괄 갱신 (KST 자정·정오) */
export async function refreshAllCachedShareStructures() {
  const store = readStore();
  const symbols = Object.keys(store.entries);
  const slot = shareStructureSlotId();
  let updated = 0;
  for (const sym of symbols) {
    const prev = store.entries[sym];
    const m = isKrSymbol(sym) ? "kr" : "us";
    try {
      const live = await fetchLiveShareStructure(sym, m);
      store.entries[sym] = {
        totalShares: live.totalShares,
        majorShareholderShares: live.majorShareholderShares,
        floatShares: live.floatShares,
        floatPct: live.floatPct,
        source: live.source ?? null,
        fetchedAtMs: Date.now(),
        fetchedAtSlot: slot,
      };
      updated++;
    } catch {
      if (prev) store.entries[sym] = prev;
    }
  }
  store.lastBulkRefreshSlot = slot;
  writeStore(store);
  return { symbols: symbols.length, updated, slot };
}

/** KST 00:00·12:00 윈도우(0~4분)에서 1회 실행 */
export function shouldRunShareStructureBulkRefresh(lastBulkRefreshSlot, now = new Date()) {
  const { hour, minute } = kstParts(now);
  if (minute > 4) return false;
  if (hour !== 0 && hour !== 12) return false;
  const slot = shareStructureSlotId(now);
  return lastBulkRefreshSlot !== slot;
}
