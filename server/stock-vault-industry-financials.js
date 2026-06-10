/**
 * 종목보관 — 동일 업종 내 재무 중앙값·대장주(시총 1위) 스냅샷
 */
import { listStockVaultItemsSync } from "./stock-vault-store.js";
import { fetchStockVaultMetaForItems } from "./stock-vault-meta.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { getOrBuildSectorLeaderIndex } from "./sector-leader-index.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "stock-vault-industry-financials.json";
const REFRESH_DEBOUNCE_MS = 3_000;
const FUNDAMENTALS_CONCURRENCY = 5;

/** @type {Promise<void> | null} */
let refreshInFlight = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;

/** @param {number[]} vals */
function median(vals) {
  const a = vals.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** @param {number | null} v @param {number} d */
function fmtNum(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

/** @param {number | null} v @param {number | null} med @param {"lower"|"higher"} better */
function metricScore(v, med, better) {
  if (v == null || med == null || !Number.isFinite(v) || !Number.isFinite(med)) {
    return { good: false, bad: false, counted: false };
  }
  if (Math.abs(med) < 1e-12) return { good: false, bad: false, counted: false };
  const ratio = v / med;
  if (better === "lower") {
    if (ratio <= 0.92) return { good: true, bad: false, counted: true };
    if (ratio >= 1.08) return { good: false, bad: true, counted: true };
    return { good: false, bad: false, counted: true };
  }
  if (ratio >= 1.08) return { good: true, bad: false, counted: true };
  if (ratio <= 0.92) return { good: false, bad: true, counted: true };
  return { good: false, bad: false, counted: true };
}

/**
 * @param {{
 *   per?: number | null;
 *   roe?: number | null;
 *   profitMargin?: number | null;
 *   pbr?: number | null;
 * }} fund
 * @param {{
 *   per?: number | null;
 *   roe?: number | null;
 *   profitMargin?: number | null;
 *   pbr?: number | null;
 * }} medians
 * @param {string} industry
 */
export function buildIndustryFinancialVerdict(fund, medians, industry) {
  let good = 0;
  let bad = 0;
  let counted = 0;

  for (const [key, better] of /** @type {const} */ ([
    ["per", "lower"],
    ["roe", "higher"],
    ["profitMargin", "higher"],
    ["pbr", "lower"],
  ])) {
    const s = metricScore(fund[key] ?? null, medians[key] ?? null, better);
    if (!s.counted) continue;
    counted += 1;
    if (s.good) good += 1;
    if (s.bad) bad += 1;
  }

  /** @type {"better"|"worse"|"similar"|"unknown"} */
  let verdict = "unknown";
  if (counted >= 2) {
    if (good >= 2 && bad === 0) verdict = "better";
    else if (bad >= 2 && good === 0) verdict = "worse";
    else verdict = "similar";
  }

  const peerGroup = industry || "동종 업종";
  const parts = [];
  if (fund.per != null && medians.per != null) {
    parts.push(`PER ${fmtNum(fund.per, 2)}배 · 업계 ${fmtNum(medians.per, 2)}배`);
  }
  if (fund.roe != null && medians.roe != null) {
    const roePct = fund.roe * 100;
    const medRoePct = medians.roe * 100;
    parts.push(`ROE ${fmtNum(roePct, 1)}% · 업계 ${fmtNum(medRoePct, 1)}%`);
  }
  if (fund.profitMargin != null && medians.profitMargin != null) {
    const pmPct = fund.profitMargin * 100;
    const medPmPct = medians.profitMargin * 100;
    parts.push(`이익률 ${fmtNum(pmPct, 1)}% · 업계 ${fmtNum(medPmPct, 1)}%`);
  }

  const verdictLabel =
    verdict === "better"
      ? "업계 평균보다 양호"
      : verdict === "worse"
        ? "업계 평균보다 부진"
        : verdict === "similar"
          ? "업계 평균과 유사"
          : "업계 비교 데이터 부족";

  const verdictDetail =
    parts.length > 0
      ? `${peerGroup} 중앙값 대비 · ${parts.join(" · ")}`
      : `${peerGroup} 비교 데이터가 제한적입니다.`;

  return { verdict, verdictLabel, verdictDetail, peerGroup };
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us"; industry?: string | null; fund: Awaited<ReturnType<typeof loadStockFundamentals>> | null }>} rows
 * @param {{ leaderBySymbol?: Record<string, {
 *   sectorLeader?: boolean;
 *   sectorLeaderDetail?: string;
 *   sectorLeaderCriteria?: string[];
 *   industryUniversePeerCount?: number;
 *   marketCapRankInIndustry?: number | null;
 * }> }} [opts]
 */
export function computeIndustryFinancialSnapshots(rows, opts = {}) {
  const leaderBySymbol = opts.leaderBySymbol ?? null;
  /** @type {Map<string, typeof rows>} */
  const byIndustry = new Map();
  for (const row of rows) {
    const industry = String(row.industry ?? "기타").trim() || "기타";
    const list = byIndustry.get(industry) ?? [];
    list.push(row);
    byIndustry.set(industry, list);
  }

  /** @type {Record<string, object>} */
  const bySymbol = {};
  const updatedAtMs = Date.now();

  for (const [industry, group] of byIndustry.entries()) {
    const funds = group.map((g) => g.fund).filter(Boolean);
    const medians = {
      per: median(funds.map((f) => f?.per ?? null)),
      roe: median(funds.map((f) => f?.roe ?? null)),
      profitMargin: median(funds.map((f) => f?.profitMargin ?? null)),
      pbr: median(funds.map((f) => f?.pbr ?? null)),
    };

    for (const row of group) {
      const sym = row.symbol.trim().toUpperCase();
      const fund = row.fund;
      const leaderPack = leaderBySymbol?.[sym];
      const verdictPack = buildIndustryFinancialVerdict(
        {
          per: fund?.per ?? null,
          roe: fund?.roe ?? null,
          profitMargin: fund?.profitMargin ?? null,
          pbr: fund?.pbr ?? null,
        },
        medians,
        industry,
      );
      bySymbol[sym] = {
        industry,
        per: fund?.per ?? null,
        roe: fund?.roe ?? null,
        pbr: fund?.pbr ?? null,
        profitMargin: fund?.profitMargin ?? null,
        marketCap: fund?.marketCap ?? null,
        industryMedianPer: medians.per,
        industryMedianRoe: medians.roe,
        industryMedianProfitMargin: medians.profitMargin,
        industryMedianPbr: medians.pbr,
        industryPeerCount: group.length,
        sectorLeader: Boolean(leaderPack?.sectorLeader),
        sectorLeaderDetail: leaderPack?.sectorLeaderDetail ?? null,
        sectorLeaderCriteria: leaderPack?.sectorLeaderCriteria ?? [],
        industryUniversePeerCount: leaderPack?.industryUniversePeerCount ?? null,
        marketCapRankInIndustry: leaderPack?.marketCapRankInIndustry ?? null,
        ...verdictPack,
        updatedAtMs,
      };
    }
  }

  return { version: 1, updatedAtMs, bySymbol };
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const root = /** @type {Record<string, unknown>} */ (raw ?? {});
  const bySymbol =
    root.bySymbol && typeof root.bySymbol === "object"
      ? /** @type {Record<string, object>} */ (root.bySymbol)
      : {};
  return {
    version: 1,
    updatedAtMs:
      typeof root.updatedAtMs === "number" && Number.isFinite(root.updatedAtMs)
        ? root.updatedAtMs
        : 0,
    bySymbol,
  };
}

export function readStockVaultIndustryFinancialsSync() {
  const store = readJsonStoreSync(STORE_FILE, normalizeStore, () => ({
    version: 1,
    updatedAtMs: 0,
    bySymbol: {},
  }));
  return store.bySymbol ?? {};
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us" }>} items
 * @param {Record<string, { industry?: string | null }>} meta
 */
export async function buildIndustryFinancialsForVaultItems(items, meta) {
  const unique = new Map();
  for (const item of items) {
    const sym = String(item?.symbol ?? "")
      .trim()
      .toUpperCase();
    if (!sym || unique.has(sym)) continue;
    unique.set(sym, item);
  }

  const symbols = [...unique.keys()];
  /** @type {Array<Awaited<ReturnType<typeof loadStockFundamentals>> | null>} */
  const fundamentals = new Array(symbols.length);

  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const idx = cursor++;
      const sym = symbols[idx];
      try {
        fundamentals[idx] = await loadStockFundamentals(sym);
      } catch {
        fundamentals[idx] = null;
      }
    }
  }
  const workers = Math.min(FUNDAMENTALS_CONCURRENCY, symbols.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const rows = symbols.map((sym, i) => ({
    symbol: sym,
    market: unique.get(sym)?.market,
    industry: meta?.[sym]?.industry ?? null,
    fund: fundamentals[i],
  }));

  let leaderBySymbol = null;
  try {
    const leaderIndex = await getOrBuildSectorLeaderIndex();
    leaderBySymbol = leaderIndex?.bySymbol ?? null;
  } catch {
    leaderBySymbol = null;
  }

  return computeIndustryFinancialSnapshots(rows, { leaderBySymbol });
}

export async function refreshStockVaultIndustryFinancialsAsync() {
  const autoItems = listStockVaultItemsSync().filter(
    (it) => it.source === "golden_cross" || it.source === "ma_align",
  );
  if (!autoItems.length) {
    writeJsonStoreSync(STORE_FILE, { version: 1, updatedAtMs: Date.now(), bySymbol: {} });
    return;
  }
  const meta = await fetchStockVaultMetaForItems(autoItems);
  const snapshot = await buildIndustryFinancialsForVaultItems(autoItems, meta);
  writeJsonStoreSync(STORE_FILE, snapshot);
}

export function scheduleStockVaultIndustryFinancialsRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (refreshInFlight) return;
    refreshInFlight = refreshStockVaultIndustryFinancialsAsync()
      .catch(() => {
        /* ignore background refresh errors */
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }, REFRESH_DEBOUNCE_MS);
}
