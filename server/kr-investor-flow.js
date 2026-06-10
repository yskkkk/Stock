/**
 * 국내 주식 — 외국인·기관·개인 순매수 (네이버 증권 trend API)
 * 대상: 국내 시총 상위 300 (기존 스캔 유니버스와 동일)
 */
import { yahooSymbolToKrCode } from "./kr-naver-quote.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadBoxRangeCatalogUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "kr-investor-flow-snapshot.json";
const NAVER_TREND_URL = "https://m.stock.naver.com/api/stock";
const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_KR_INVESTOR_FLOW_BATCH ?? 12);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : 12;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_KR_INVESTOR_FLOW_BATCH_DELAY_MS ?? 180);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 2_000) : 180;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} raw */
export function parseNaverPureBuyQuant(raw) {
  const s = String(raw ?? "")
    .replace(/,/g, "")
    .replace(/\+/g, "")
    .trim();
  if (!s || s === "—" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} raw */
function parseNaverPrice(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {unknown} raw */
function parseHoldRatio(raw) {
  const m = String(raw ?? "").match(/([\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** @param {string} bizdate YYYYMMDD */
function formatBizDate(bizdate) {
  const s = String(bizdate ?? "").trim();
  if (s.length !== 8) return s || null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * @param {string} code 6-digit
 */
async function fetchKrInvestorTrend(code) {
  const res = await fetch(
    `${NAVER_TREND_URL}/${code}/trend?pageSize=1&bizDate=`,
    {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) throw new Error(`Naver trend HTTP ${res.status}`);
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;
  return row;
}

/**
 * @param {{ symbol: string; name?: string }} item
 */
async function scanOneKrInvestorFlow(item) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  const code = yahooSymbolToKrCode(sym);
  if (!code) return { ok: false, row: null };

  try {
    const trend = await fetchKrInvestorTrend(code);
    if (!trend) return { ok: true, row: null };

    const foreignNetQty = parseNaverPureBuyQuant(trend.foreignerPureBuyQuant);
    const institutionNetQty = parseNaverPureBuyQuant(trend.organPureBuyQuant);
    const individualNetQty = parseNaverPureBuyQuant(trend.individualPureBuyQuant);
    const closePrice = parseNaverPrice(trend.closePrice);

    if (
      foreignNetQty == null &&
      institutionNetQty == null &&
      individualNetQty == null
    ) {
      return { ok: true, row: null };
    }

    return {
      ok: true,
      row: {
        symbol: sym.includes(".") ? sym : `${code}.KS`,
        name: resolveDisplayName(sym, item.name),
        bizDate: formatBizDate(trend.bizdate),
        closePrice,
        foreignNetQty,
        foreignHoldRatio: parseHoldRatio(trend.foreignerHoldRatio),
        institutionNetQty,
        individualNetQty,
        accumulatedVolume: parseNaverPureBuyQuant(trend.accumulatedTradingVolume),
      },
    };
  } catch (e) {
    liveTradeLogWarn(
      "[kr-investor-flow]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, row: null };
  }
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const root = /** @type {Record<string, unknown>} */ (raw ?? {});
  const items = Array.isArray(root.items) ? root.items : [];
  return {
    version: 1,
    updatedAtMs:
      typeof root.updatedAtMs === "number" && Number.isFinite(root.updatedAtMs)
        ? root.updatedAtMs
        : 0,
    bizDate: typeof root.bizDate === "string" ? root.bizDate : null,
    scanned: typeof root.scanned === "number" ? root.scanned : items.length,
    itemCount: items.length,
    items,
  };
}

export function readKrInvestorFlowSnapshotSync() {
  return readJsonStoreSync(STORE_FILE, normalizeStore, () => ({
    version: 1,
    updatedAtMs: 0,
    bizDate: null,
    scanned: 0,
    itemCount: 0,
    items: [],
  }));
}

export function krInvestorFlowEnabled() {
  const v = String(process.env.STOCK_KR_INVESTOR_FLOW ?? "1")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

export async function runKrInvestorFlowScan() {
  const uni = await loadBoxRangeCatalogUniverse();
  const list = Array.isArray(uni?.kr) ? uni.kr : [];

  liveTradeLogInfo("[kr-investor-flow] scan start", { symbols: list.length });

  /** @type {NonNullable<Awaited<ReturnType<typeof scanOneKrInvestorFlow>>["row"]>[]} */
  const items = [];
  let errors = 0;
  let bizDate = null;

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((item) => scanOneKrInvestorFlow(item)));
    for (const r of results) {
      if (!r.ok) {
        errors += 1;
        continue;
      }
      if (r.row) {
        items.push(r.row);
        if (!bizDate && r.row.bizDate) bizDate = r.row.bizDate;
      }
    }
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }

  const snapshot = {
    version: 1,
    updatedAtMs: Date.now(),
    bizDate,
    scanned: list.length,
    itemCount: items.length,
    items,
  };
  writeJsonStoreSync(STORE_FILE, snapshot);

  liveTradeLogInfo("[kr-investor-flow] scan done", {
    scanned: list.length,
    items: items.length,
    errors,
    bizDate,
  });

  return snapshot;
}
