/**
 * 업종 대장주 — 국내 시총 300 + 미국 S&P500 유니버스 기준 (보관함 한정 아님)
 */
import { getUsdKrwRate } from "./fx-usd-krw.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { fetchStockVaultMetaForItems } from "./stock-vault-meta.js";
import { loadKrSymbolMarketCapKrwMap, loadUniverse } from "./universe.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STORE_FILE = "sector-leader-universe-cache.json";
const CACHE_TTL_MS = 12 * 60 * 60_000;
const FUNDAMENTALS_CONCURRENCY = 6;
const MIN_INDUSTRY_PEERS = 3;
const MIN_CAP_RATIO_TO_SECOND = 1.3;

/** @type {Promise<{ bySymbol: Record<string, object>; updatedAtMs: number }> | null} */
let buildInFlight = null;

/** @param {number[]} vals */
function median(vals) {
  const a = vals.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** @param {number | null | undefined} cap @param {number | null | undefined} usdKrw */
function marketCapToUsd(cap, market, usdKrw) {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return null;
  if (market === "us") return cap;
  const fx = usdKrw != null && Number.isFinite(usdKrw) && usdKrw > 0 ? usdKrw : null;
  if (!fx) return null;
  return cap / fx;
}

/**
 * @param {Array<{
 *   symbol: string;
 *   market: "kr"|"us";
 *   industry: string;
 *   marketCapUsd: number | null;
 *   roe?: number | null;
 *   profitMargin?: number | null;
 *   revenueGrowth?: number | null;
 * }>} group
 */
export function evaluateSectorLeaderForIndustry(group) {
  const peers = group.filter((g) => g.marketCapUsd != null && Number.isFinite(g.marketCapUsd));
  const peerCount = peers.length;
  const medians = {
    roe: median(peers.map((p) => p.roe ?? null)),
    profitMargin: median(peers.map((p) => p.profitMargin ?? null)),
    revenueGrowth: median(peers.map((p) => p.revenueGrowth ?? null)),
  };

  const sorted = [...peers].sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
  const leader = sorted[0] ?? null;
  const secondCap = sorted[1]?.marketCapUsd ?? null;

  /** @type {Record<string, object>} */
  const bySymbol = {};

  for (const row of group) {
    const sym = row.symbol.trim().toUpperCase();
    const cap = row.marketCapUsd;
    const rank =
      cap != null && Number.isFinite(cap)
        ? sorted.findIndex((p) => p.symbol === row.symbol) + 1
        : null;
    const capRatio =
      rank === 1 && secondCap != null && secondCap > 0 && cap != null
        ? cap / secondCap
        : null;

    /** @type {string[]} */
    const criteriaMet = [];
    /** @type {string[]} */
    const criteriaDetail = [];

    const rankOk = rank === 1;
    if (rankOk) {
      criteriaMet.push("market_cap_rank");
      criteriaDetail.push("국내·미국 통합 업종 시총 1위");
    }

    const gapOk =
      rankOk &&
      (peerCount < 2 ||
        (capRatio != null && capRatio >= MIN_CAP_RATIO_TO_SECOND));
    if (gapOk && rankOk && peerCount >= 2) {
      criteriaMet.push("cap_gap");
      criteriaDetail.push(`2위 대비 시총 ${capRatio != null ? capRatio.toFixed(1) : "—"}배`);
    }

    const peersOk = peerCount >= MIN_INDUSTRY_PEERS;
    if (peersOk) {
      criteriaMet.push("min_peers");
    }

    const hasProfitMetric =
      (row.roe != null && Number.isFinite(row.roe)) ||
      (row.profitMargin != null && Number.isFinite(row.profitMargin));
    const hasProfitMedian =
      (medians.roe != null && Number.isFinite(medians.roe)) ||
      (medians.profitMargin != null && Number.isFinite(medians.profitMargin));

    let profitOk = true;
    if (hasProfitMetric && hasProfitMedian) {
      const roeOk =
        row.roe != null &&
        medians.roe != null &&
        Number.isFinite(row.roe) &&
        row.roe >= medians.roe;
      const marginOk =
        row.profitMargin != null &&
        medians.profitMargin != null &&
        Number.isFinite(row.profitMargin) &&
        row.profitMargin >= medians.profitMargin;
      profitOk = roeOk || marginOk;
      if (profitOk) {
        criteriaMet.push("profitability");
        if (roeOk) criteriaDetail.push("ROE 업종 중앙값 이상");
        else if (marginOk) criteriaDetail.push("이익률 업종 중앙값 이상");
      }
    } else {
      criteriaMet.push("profitability_waived");
    }

    const hasGrowth =
      row.revenueGrowth != null && Number.isFinite(row.revenueGrowth);
    const growthMedianOk =
      medians.revenueGrowth != null && Number.isFinite(medians.revenueGrowth);
    let growthOk = false;
    if (hasGrowth && growthMedianOk) {
      growthOk = row.revenueGrowth >= medians.revenueGrowth;
      if (growthOk) {
        criteriaMet.push("revenue_growth");
        criteriaDetail.push("매출성장률 업종 중앙값 이상");
      }
    }

    const sectorLeader =
      rankOk &&
      gapOk &&
      peersOk &&
      (profitOk || !hasProfitMetric || !hasProfitMedian);

    bySymbol[sym] = {
      sectorLeader,
      sectorLeaderCriteria: criteriaMet,
      sectorLeaderDetail:
        criteriaDetail.length > 0
          ? criteriaDetail.join(" · ")
          : "업종 대장주 기준 미충족",
      industryUniversePeerCount: peerCount,
      marketCapRankInIndustry: rank,
      marketCapUsd: cap,
      revenueGrowthLeader: growthOk,
    };
  }

  return {
    leaderSymbol: leader?.symbol?.trim().toUpperCase() ?? null,
    bySymbol,
    peerCount,
  };
}

/**
 * @param {Array<{
 *   symbol: string;
 *   market: "kr"|"us";
 *   industry: string;
 *   marketCapUsd: number | null;
 *   roe?: number | null;
 *   profitMargin?: number | null;
 *   revenueGrowth?: number | null;
 * }>} rows
 */
export function buildSectorLeaderIndex(rows) {
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

  for (const [, group] of byIndustry.entries()) {
    const evaluated = evaluateSectorLeaderForIndustry(group);
    Object.assign(bySymbol, evaluated.bySymbol);
  }

  return { version: 1, updatedAtMs, bySymbol };
}

/**
 * @param {unknown} raw
 */
function normalizeCache(raw) {
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

function readSectorLeaderCacheSync() {
  return readJsonStoreSync(STORE_FILE, normalizeCache, () => ({
    version: 1,
    updatedAtMs: 0,
    bySymbol: {},
  }));
}

async function buildUniverseLeaderRows() {
  const [{ kr, us }, krCapMap, fx] = await Promise.all([
    loadUniverse(),
    loadKrSymbolMarketCapKrwMap(),
    getUsdKrwRate().catch(() => ({ rate: null })),
  ]);
  const usdKrw = fx?.rate ?? null;

  /** @type {Array<{ symbol: string; market: "kr"|"us" }>} */
  const universeItems = [
    ...kr.map((row) => ({ symbol: row.symbol, market: /** @type {const} */ ("kr") })),
    ...us.map((row) => ({ symbol: row.symbol, market: /** @type {const} */ ("us") })),
  ];

  const meta = await fetchStockVaultMetaForItems(universeItems);
  const symbols = universeItems.map((it) => it.symbol.trim().toUpperCase());
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

  return universeItems.map((item, idx) => {
    const sym = item.symbol.trim().toUpperCase();
    const fund = fundamentals[idx];
    const market = item.market;
    const capKrw = market === "kr" ? krCapMap.get(sym) ?? null : null;
    const capRaw =
      market === "kr"
        ? capKrw
        : fund?.marketCap ?? null;
    return {
      symbol: sym,
      market,
      industry: meta?.[sym]?.industry ?? "기타",
      marketCapUsd: marketCapToUsd(capRaw, market, usdKrw),
      roe: fund?.roe ?? null,
      profitMargin: fund?.profitMargin ?? null,
      revenueGrowth: fund?.revenueGrowth ?? null,
    };
  });
}

async function rebuildSectorLeaderCache() {
  const rows = await buildUniverseLeaderRows();
  const index = buildSectorLeaderIndex(rows);
  writeJsonStoreSync(STORE_FILE, index);
  return index;
}

export async function getOrBuildSectorLeaderIndex(opts = {}) {
  const force = opts.force === true;
  const cached = readSectorLeaderCacheSync();
  if (
    !force &&
    cached.updatedAtMs > 0 &&
    Date.now() - cached.updatedAtMs < CACHE_TTL_MS &&
    Object.keys(cached.bySymbol).length > 0
  ) {
    return cached;
  }
  if (buildInFlight) return buildInFlight;
  buildInFlight = rebuildSectorLeaderCache()
    .catch((e) => {
      if (cached.bySymbol && Object.keys(cached.bySymbol).length > 0) {
        return cached;
      }
      throw e;
    })
    .finally(() => {
      buildInFlight = null;
    });
  return buildInFlight;
}
