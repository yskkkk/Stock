/**
 * 국내 주식 — 외국인·기관·개인 순매수 (네이버 증권 trend API)
 * 대상: 국내 시총 상위 300 (기존 스캔 유니버스와 동일)
 */
import { fetchKrNaverIndustryRawName } from "./kr-naver-industry.js";
import { yahooSymbolToKrCode } from "./kr-naver-quote.js";
import { resolveDisplayName } from "./names-ko.js";
import { localizeIndustry } from "./stock-vault-meta.js";
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

/** @param {unknown} trend */
export function parseTrendChangePercent(trend) {
  if (!trend || typeof trend !== "object") return null;
  const close = parseNaverPrice(
    /** @type {{ closePrice?: unknown }} */ (trend).closePrice,
  );
  const diff = parseNaverPureBuyQuant(
    /** @type {{ compareToPreviousClosePrice?: unknown }} */ (trend)
      .compareToPreviousClosePrice,
  );
  if (close == null || diff == null) return null;
  const prev = close - diff;
  if (prev <= 0) return null;
  const pct = (diff / prev) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/** @param {unknown} closePrice @param {unknown} volume */
export function parseTrendTradingValue(closePrice, volume) {
  const px = parseNaverPrice(closePrice);
  const vol = parseNaverPureBuyQuant(volume);
  if (px == null || vol == null || vol <= 0) return null;
  const value = px * vol;
  return Number.isFinite(value) && value > 0 ? value : null;
}

const NAVER_DOMESTIC_POLL_URL =
  "https://polling.finance.naver.com/api/realtime/domestic/stock";

/** @param {string} code 6-digit */
async function fetchKrDomesticPollRow(code) {
  const res = await fetch(`${NAVER_DOMESTIC_POLL_URL}/${code}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Naver poll HTTP ${res.status}`);
  const data = await res.json();
  const row = Array.isArray(data?.datas) ? data.datas[0] : null;
  if (!row || typeof row !== "object") return null;
  return /** @type {Record<string, unknown>} */ (row);
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
    const changePercent = parseTrendChangePercent(trend);
    const tradingValue = parseTrendTradingValue(
      trend.closePrice,
      trend.accumulatedTradingVolume,
    );

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
        changePercent,
        tradingValue,
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
  const industryTabs = Array.isArray(root.industryTabs)
    ? root.industryTabs.map((x) => String(x))
    : buildIndustryTabs(items);
  const industrySummary = Array.isArray(root.industrySummary)
    ? root.industrySummary
    : buildIndustrySummary(items);
  return {
    version: 1,
    updatedAtMs:
      typeof root.updatedAtMs === "number" && Number.isFinite(root.updatedAtMs)
        ? root.updatedAtMs
        : 0,
    bizDate: typeof root.bizDate === "string" ? root.bizDate : null,
    scanned: typeof root.scanned === "number" ? root.scanned : items.length,
    itemCount: items.length,
    industryTabs,
    industrySummary,
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
    industryTabs: [],
    industrySummary: [],
    items: [],
  }));
}

export function krInvestorFlowEnabled() {
  const v = String(process.env.STOCK_KR_INVESTOR_FLOW ?? "1")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * @param {Awaited<ReturnType<typeof scanOneKrInvestorFlow>>["row"][]} items
 */
async function enrichKrInvestorFlowIndustry(items) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(
      batch.map(async (row) => {
        if (!row) return null;
        let industry = "기타";
        try {
          const raw = await fetchKrNaverIndustryRawName(row.symbol);
          industry = localizeIndustry(raw) ?? "기타";
        } catch {
          industry = "기타";
        }
        return { ...row, industry };
      }),
    );
    for (const row of rows) {
      if (row) out.push(row);
    }
    if (i + BATCH_SIZE < items.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }
  return out;
}

/** @param {Array<{ industry?: string; foreignNetQty?: number | null; institutionNetQty?: number | null; individualNetQty?: number | null }>} items */
function buildIndustrySummary(items) {
  /** @type {Map<string, { industry: string; count: number; foreignNetQty: number; institutionNetQty: number; individualNetQty: number }>} */
  const map = new Map();
  for (const row of items) {
    const industry = String(row.industry ?? "기타").trim() || "기타";
    let g = map.get(industry);
    if (!g) {
      g = {
        industry,
        count: 0,
        foreignNetQty: 0,
        institutionNetQty: 0,
        individualNetQty: 0,
      };
      map.set(industry, g);
    }
    g.count += 1;
    g.foreignNetQty += Number(row.foreignNetQty) || 0;
    g.institutionNetQty += Number(row.institutionNetQty) || 0;
    g.individualNetQty += Number(row.individualNetQty) || 0;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry, "ko"));
}

/** @param {Array<{ industry?: string }>} items */
function buildIndustryTabs(items) {
  const counts = new Map();
  for (const row of items) {
    const industry = String(row.industry ?? "기타").trim() || "기타";
    counts.set(industry, (counts.get(industry) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .map(([name]) => name);
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

  const enriched = await enrichKrInvestorFlowIndustry(items);
  const industryTabs = buildIndustryTabs(enriched);
  const industrySummary = buildIndustrySummary(enriched);

  const snapshot = {
    version: 1,
    updatedAtMs: Date.now(),
    bizDate,
    scanned: list.length,
    itemCount: enriched.length,
    industryTabs,
    industrySummary,
    items: enriched,
  };
  writeJsonStoreSync(STORE_FILE, snapshot);

  liveTradeLogInfo("[kr-investor-flow] scan done", {
    scanned: list.length,
    items: enriched.length,
    errors,
    bizDate,
  });

  return snapshot;
}

/**
 * 종목 클릭 시 보유·수급 말풍선용 상세 (상장주식수·외국인 보유주식수)
 * @param {string} symbol
 * @param {Record<string, unknown> | null} [rowHint]
 */
export async function loadKrInvestorFlowHoldingsDetail(symbol, rowHint = null) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const code = yahooSymbolToKrCode(sym);
  if (!code) {
    const err = new Error("올바르지 않은 심볼 형식입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }

  const poll = await fetchKrDomesticPollRow(code);
  if (!poll) {
    const err = new Error("시세 데이터를 찾을 수 없습니다.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const closeRaw = Number(poll.closePriceRaw);
  const marketValueRaw = Number(poll.marketValueFullRaw);
  const listedShares =
    Number.isFinite(closeRaw) &&
    closeRaw > 0 &&
    Number.isFinite(marketValueRaw) &&
    marketValueRaw > 0
      ? Math.round(marketValueRaw / closeRaw)
      : null;

  const foreignHoldRatio =
    typeof rowHint?.foreignHoldRatio === "number" &&
    Number.isFinite(rowHint.foreignHoldRatio)
      ? rowHint.foreignHoldRatio
      : parseHoldRatio(poll.foreignerHoldRatio);

  const foreignHoldShares =
    listedShares != null && foreignHoldRatio != null
      ? Math.round((listedShares * foreignHoldRatio) / 100)
      : null;

  const tradingValueRaw = Number(poll.accumulatedTradingValueRaw);
  const changePercentRaw = Number(poll.fluctuationsRatioRaw);

  return {
    symbol: sym.includes(".") ? sym : `${code}.KS`,
    name:
      (typeof rowHint?.name === "string" && rowHint.name.trim()) ||
      String(poll.stockName ?? "").trim() ||
      resolveDisplayName(sym),
    listedShares,
    foreignHoldRatio,
    foreignHoldShares,
    foreignNetQty:
      typeof rowHint?.foreignNetQty === "number" ? rowHint.foreignNetQty : null,
    institutionNetQty:
      typeof rowHint?.institutionNetQty === "number"
        ? rowHint.institutionNetQty
        : null,
    individualNetQty:
      typeof rowHint?.individualNetQty === "number"
        ? rowHint.individualNetQty
        : null,
    changePercent: Number.isFinite(changePercentRaw) ? changePercentRaw : null,
    tradingValue:
      Number.isFinite(tradingValueRaw) && tradingValueRaw > 0
        ? tradingValueRaw
        : null,
    updatedAtMs: Date.now(),
  };
}
