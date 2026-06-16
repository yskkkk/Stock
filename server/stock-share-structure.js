/**
 * 종목 주식 수량 — 전체·대주주·유동 (디스크 캐시, KR·US 정규장 마감 후 유니버스 스캔)
 */
import { getTradingSessionKey } from "./market-hours.js";
import { loadUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { queueYahooRequest } from "./yahoo-queue.js";
import { yahooGet } from "./yahoo.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import { dartApiGet, isDartEnabled, resolveDartCorpCode } from "./dart.js";
import {
  finalizeKrFloatShares,
  parseFnGuideLabelShareRow,
  parseFnGuideTitledShareRow,
  sumStrategicInvestorSharesFromDart,
} from "./stock-share-structure-float.js";

const STORE_FILE = "stock-share-structure.json";
const FNGUIDE_UA = "Mozilla/5.0 (compatible; StockApp/1.0)";

const SCAN_CONCURRENCY = (() => {
  const n = Number(process.env.STOCK_SHARE_STRUCTURE_CONCURRENCY ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 4;
})();

const SCAN_BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_SHARE_STRUCTURE_BATCH_DELAY_MS ?? 280);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 280;
})();

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

/**
 * @typedef {Object} ShareStructureEntry
 * @property {number | null} totalShares
 * @property {number | null} majorShareholderShares
 * @property {number | null} treasuryShares
 * @property {number | null} employeeStockShares
 * @property {number | null} lockupShares
 * @property {number | null} governmentShares
 * @property {number | null} overseasDrShares
 * @property {number | null} strategicInvestorShares
 * @property {number | null} otherNonFloatShares
 * @property {number | null} indexAdjustmentShares
 * @property {number | null} floatShares
 * @property {number | null} floatPct
 * @property {string | null} source
 * @property {number} fetchedAtMs
 * @property {string} fetchedAtSlot
 */

/**
 * @typedef {Object} ShareStructureMarketMeta
 * @property {string | null} lastSessionKey
 * @property {number | null} lastRunAtMs
 * @property {number} symbolCount
 * @property {number} okCount
 * @property {number} failCount
 */

/**
 * @param {unknown} raw
 */
function normalizeMarketMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  return {
    lastSessionKey:
      typeof o.lastSessionKey === "string" ? o.lastSessionKey : null,
    lastRunAtMs:
      typeof o.lastRunAtMs === "number" && Number.isFinite(o.lastRunAtMs)
        ? o.lastRunAtMs
        : null,
    symbolCount:
      typeof o.symbolCount === "number" && Number.isFinite(o.symbolCount)
        ? o.symbolCount
        : 0,
    okCount:
      typeof o.okCount === "number" && Number.isFinite(o.okCount) ? o.okCount : 0,
    failCount:
      typeof o.failCount === "number" && Number.isFinite(o.failCount)
        ? o.failCount
        : 0,
  };
}

/**
 * @param {unknown} raw
 * @returns {{ entries: Record<string, ShareStructureEntry>; meta: { kr: ShareStructureMarketMeta | null; us: ShareStructureMarketMeta | null } }}
 */
function normalizeStore(raw) {
  const entries =
    raw && typeof raw === "object" && raw.entries && typeof raw.entries === "object"
      ? /** @type {Record<string, ShareStructureEntry>} */ (raw.entries)
      : {};
  const metaRaw =
    raw && typeof raw === "object" && raw.meta && typeof raw.meta === "object"
      ? raw.meta
      : {};
  return {
    entries,
    meta: {
      kr: normalizeMarketMeta(/** @type {Record<string, unknown>} */ (metaRaw).kr),
      us: normalizeMarketMeta(/** @type {Record<string, unknown>} */ (metaRaw).us),
    },
  };
}

function emptyStore() {
  return { entries: {}, meta: { kr: null, us: null } };
}

function readStore() {
  return readJsonStoreSync(STORE_FILE, normalizeStore, emptyStore);
}

/** @param {ReturnType<typeof readStore>} store */
function writeStore(store) {
  writeJsonStoreSync(STORE_FILE, store);
}

export function readShareStructureMeta() {
  return readStore().meta;
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 */
function parseFnGuideShareComponents(html) {
  const totalM = html.match(
    /발행주식수<span class="csize">\(보통주\/ 우선주\)<\/span><\/div><\/th>\s*<td class="r">([\d,]+)/,
  );
  const floatM = html.match(
    /유동주식수\/비율<\/a>[\s\S]*?<td class="r">([\d,]+)\s*\/\s*([\d.]+)/,
  );
  const totalShares = totalM ? parseCommaNum(totalM[1]) : null;
  const publishedFloatShares = floatM ? parseCommaNum(floatM[1]) : null;
  const publishedFloatPct = floatM ? Number(floatM[2]) : null;
  const majorShareholderShares =
    parseFnGuideTitledShareRow(html, "최대주주등") ??
    (() => {
      const majorM = html.match(
        /최대주주등&nbsp;\(본인\+특별관계자\)[\s\S]*?<td class="r">\d+<\/td><td class="r">([\d,]+)<\/td>/,
      );
      return majorM ? parseCommaNum(majorM[1]) : null;
    })();

  return {
    totalShares,
    publishedFloatShares,
    publishedFloatPct:
      publishedFloatPct != null && Number.isFinite(publishedFloatPct)
        ? publishedFloatPct
        : null,
    majorShareholderShares,
    treasuryShares:
      parseFnGuideTitledShareRow(html, "자기주식") ??
      parseFnGuideLabelShareRow(html, "자사주"),
    employeeStockShares: parseFnGuideTitledShareRow(html, "우리사주조합"),
    lockupShares: parseFnGuideTitledShareRow(html, "보호예수"),
    governmentShares: parseFnGuideTitledShareRow(html, "정부기관"),
    overseasDrShares: parseFnGuideTitledShareRow(html, "해외DR"),
    strategicInvestorShares: null,
  };
}

/** @param {string} symbol */
async function fetchStrategicInvestorSharesKr(symbol) {
  if (!isDartEnabled()) return null;
  const corpCode = await resolveDartCorpCode(symbol);
  if (!corpCode) return null;
  const data = await dartApiGet("/majorstock.json", { corp_code: corpCode });
  if (!data?.list?.length) return null;
  return sumStrategicInvestorSharesFromDart(data.list);
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
  const components = parseFnGuideShareComponents(html);
  if (
    !components.totalShares &&
    !components.publishedFloatShares &&
    !components.majorShareholderShares &&
    !components.treasuryShares
  ) {
    return null;
  }
  const strategicInvestorShares = await fetchStrategicInvestorSharesKr(symbol).catch(
    () => null,
  );
  const finalized = finalizeKrFloatShares({
    ...components,
    strategicInvestorShares,
  });
  if (!finalized) return null;
  return { ...finalized, source: "FnGuide" };
}

/** @param {string} yahooSym */
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

/** @param {string} symbol @param {"kr"|"us"} market */
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

/** @param {string} symbol @param {"kr"|"us"} market */
async function fetchLiveShareStructure(symbol, market) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const m = market === "kr" || market === "us" ? market : isKrSymbol(sym) ? "kr" : "us";

  const yahoo = await fetchYahooShareStats(sym, m).catch(() => null);
  if (m === "kr") {
    const fg = await fetchFnGuideKr(sym).catch(() => null);
    if (fg) {
      const totalShares = fg.totalShares ?? yahoo?.totalShares ?? null;
      const indexAdjustmentShares =
        fg.indexAdjustmentShares ?? fg.totalShares ?? totalShares;
      const floatShares = fg.floatShares ?? yahoo?.floatShares ?? null;
      const majorShareholderShares =
        fg.majorShareholderShares ?? yahoo?.majorShareholderShares ?? null;
      return {
        totalShares,
        indexAdjustmentShares,
        majorShareholderShares,
        treasuryShares: fg.treasuryShares ?? null,
        employeeStockShares: fg.employeeStockShares ?? null,
        lockupShares: fg.lockupShares ?? null,
        governmentShares: fg.governmentShares ?? null,
        overseasDrShares: fg.overseasDrShares ?? null,
        strategicInvestorShares: fg.strategicInvestorShares ?? null,
        otherNonFloatShares: fg.otherNonFloatShares ?? null,
        floatShares,
        floatPct:
          floatShares != null && indexAdjustmentShares != null && indexAdjustmentShares > 0
            ? fg.floatPct ?? deriveFloatPct(indexAdjustmentShares, floatShares, fg.floatPct)
            : fg.floatPct ?? deriveFloatPct(totalShares, floatShares, fg.floatPct),
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
    indexAdjustmentShares: entry.indexAdjustmentShares ?? null,
    majorShareholderShares: entry.majorShareholderShares,
    treasuryShares: entry.treasuryShares ?? null,
    employeeStockShares: entry.employeeStockShares ?? null,
    lockupShares: entry.lockupShares ?? null,
    governmentShares: entry.governmentShares ?? null,
    overseasDrShares: entry.overseasDrShares ?? null,
    strategicInvestorShares: entry.strategicInvestorShares ?? null,
    otherNonFloatShares: entry.otherNonFloatShares ?? null,
    floatShares: entry.floatShares,
    floatPct: entry.floatPct,
    source: entry.source,
    fetchedAtMs: entry.fetchedAtMs,
    fetchedAtSlot: entry.fetchedAtSlot,
  };
}

/** @param {string} symbol @param {ShareStructureEntry | undefined} entry */
function isEntryFresh(symbol, entry) {
  if (!entry?.fetchedAtSlot) return false;
  const market = isKrSymbol(symbol) ? "kr" : "us";
  return entry.fetchedAtSlot === getTradingSessionKey(market);
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
  if (cached && isEntryFresh(sym, cached)) {
    return toApiPayload(sym, cached);
  }

  const m =
    market === "kr" || market === "us"
      ? market
      : isKrSymbol(sym)
        ? "kr"
        : "us";
  const live = await fetchLiveShareStructure(sym, m);
  const slot = getTradingSessionKey(m);
  const entry = {
    totalShares: live.totalShares,
    indexAdjustmentShares: live.indexAdjustmentShares ?? live.totalShares,
    majorShareholderShares: live.majorShareholderShares,
    treasuryShares: live.treasuryShares ?? null,
    employeeStockShares: live.employeeStockShares ?? null,
    lockupShares: live.lockupShares ?? null,
    governmentShares: live.governmentShares ?? null,
    overseasDrShares: live.overseasDrShares ?? null,
    strategicInvestorShares: live.strategicInvestorShares ?? null,
    otherNonFloatShares: live.otherNonFloatShares ?? null,
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

/**
 * @param {Array<{ symbol: string }>} items
 * @param {number} limit
 * @param {(item: { symbol: string }) => Promise<{ ok: boolean; symbol: string }>} worker
 */
async function mapConcurrent(items, limit, worker) {
  /** @type {Promise<{ ok: boolean; symbol: string }>[]} */
  const results = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      results[idx] = await worker(item);
      if (SCAN_BATCH_DELAY_MS > 0) await delay(SCAN_BATCH_DELAY_MS);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * 스캔 유니버스(KR·US) 전체 주식 수량 갱신
 * @param {"kr"|"us"} market
 */
export async function runShareStructureScanForMarket(market) {
  const uni = await loadUniverse();
  const list = (market === "kr" ? uni.kr : uni.us).filter((row) => row?.symbol);
  const sessionKey = getTradingSessionKey(market);
  const store = readStore();
  const entries = { ...store.entries };

  liveTradeLogInfo("[share-structure] scan start", {
    market,
    symbols: list.length,
    sessionKey,
  });

  const started = Date.now();
  const results = await mapConcurrent(list, SCAN_CONCURRENCY, async (row) => {
    const sym = String(row.symbol).trim().toUpperCase();
    try {
      const live = await fetchLiveShareStructure(sym, market);
      entries[sym] = {
        totalShares: live.totalShares,
        indexAdjustmentShares: live.indexAdjustmentShares ?? live.totalShares,
        majorShareholderShares: live.majorShareholderShares,
        treasuryShares: live.treasuryShares ?? null,
        employeeStockShares: live.employeeStockShares ?? null,
        lockupShares: live.lockupShares ?? null,
        governmentShares: live.governmentShares ?? null,
        overseasDrShares: live.overseasDrShares ?? null,
        strategicInvestorShares: live.strategicInvestorShares ?? null,
        otherNonFloatShares: live.otherNonFloatShares ?? null,
        floatShares: live.floatShares,
        floatPct: live.floatPct,
        source: live.source ?? null,
        fetchedAtMs: Date.now(),
        fetchedAtSlot: sessionKey,
      };
      return { ok: true, symbol: sym };
    } catch {
      return { ok: false, symbol: sym };
    }
  });

  const okCount = results.filter((r) => r?.ok).length;
  const failCount = results.length - okCount;

  store.entries = entries;
  store.meta[market] = {
    lastSessionKey: sessionKey,
    lastRunAtMs: Date.now(),
    symbolCount: list.length,
    okCount,
    failCount,
  };
  writeStore(store);

  liveTradeLogInfo("[share-structure] scan done", {
    market,
    sessionKey,
    ms: Date.now() - started,
    okCount,
    failCount,
  });

  if (failCount > 0) {
    liveTradeLogWarn("[share-structure] partial failures", {
      market,
      failCount,
      sample: results.filter((r) => !r?.ok).slice(0, 5).map((r) => r?.symbol),
    });
  }

  return { market, sessionKey, symbolCount: list.length, okCount, failCount };
}
