/**
 * 스캔 유니버스(KR·US) 종목별 재무제표 일일 아카이브
 */
import { loadStockFundamentals } from "./stock-fundamentals.js";
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { loadUniverse } from "./universe.js";
import { getTradingSessionKey } from "./market-hours.js";
import {
  readFinancialsArchiveMeta,
  withLiveFinancialsFetch,
  writeFinancialsArchiveMeta,
  writeSymbolFinancialArchive,
} from "./stock-financials-archive-store.js";

const CONCURRENCY = (() => {
  const n = Number(process.env.STOCK_FINANCIALS_ARCHIVE_CONCURRENCY ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_FINANCIALS_ARCHIVE_BATCH_DELAY_MS ?? 350);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 350;
})();

const ANNUAL_DETAIL_LIMIT = 4;
const QUARTER_DETAIL_LIMIT = 2;

/**
 * @typedef {object} SymbolFinancialArchive
 * @property {string} symbol
 * @property {"kr"|"us"} market
 * @property {string} name
 * @property {string} currency
 * @property {number} archivedAtMs
 * @property {Awaited<ReturnType<typeof loadStockFundamentals>> | null} fundamentals
 * @property {Awaited<ReturnType<typeof loadFinancialPeriods>> | null} periods
 * @property {Record<string, Awaited<ReturnType<typeof loadFinancialStatementDetail>>>} statements
 */

/**
 * @typedef {object} FinancialsArchiveMarketMeta
 * @property {string | null} lastSessionKey
 * @property {number | null} lastRunAtMs
 * @property {number} symbolCount
 * @property {number} okCount
 * @property {number} failCount
 */

/**
 * @typedef {{ kr: FinancialsArchiveMarketMeta | null; us: FinancialsArchiveMarketMeta | null }} FinancialsArchiveMeta
 */

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {Awaited<ReturnType<typeof loadFinancialPeriods>>["periods"]} periods
 */
export function selectPeriodIdsForArchive(periods) {
  const annual = periods
    .filter((p) => p.kind === "annual" && !p.isForecast)
    .slice(0, ANNUAL_DETAIL_LIMIT);
  const quarter = periods
    .filter((p) => p.kind === "quarter" && !p.isForecast)
    .slice(0, QUARTER_DETAIL_LIMIT);
  return [...annual, ...quarter].map((p) => p.id);
}

/**
 * @param {string} symbol
 */
export async function archiveFinancialsForSymbol(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  return withLiveFinancialsFetch(async () => {
    const [fundamentals, periods] = await Promise.all([
      loadStockFundamentals(sym, { forceLive: true }).catch(() => null),
      loadFinancialPeriods(sym, { forceLive: true }).catch(() => null),
    ]);

    /** @type {Record<string, Awaited<ReturnType<typeof loadFinancialStatementDetail>>>} */
    const statements = {};
    if (periods?.periods?.length) {
      for (const periodId of selectPeriodIdsForArchive(periods.periods)) {
        try {
          const detail = await loadFinancialStatementDetail(sym, periodId, {
            forceLive: true,
          });
          statements[periodId] = detail;
        } catch {
          /* 개별 기간 실패는 전체 실패로 보지 않음 */
        }
        if (BATCH_DELAY_MS > 0) await delay(BATCH_DELAY_MS);
      }
    }

    if (!periods?.periods?.length && !fundamentals) {
      return { ok: false, symbol: sym, error: "periods_and_fundamentals_missing" };
    }

    const market =
      periods?.market ?? fundamentals?.market ?? (sym.endsWith(".KS") || sym.endsWith(".KQ") ? "kr" : "us");

    /** @type {SymbolFinancialArchive} */
    const payload = {
      symbol: sym,
      market: market === "kr" ? "kr" : "us",
      name: periods?.name ?? fundamentals?.name ?? sym,
      currency: periods?.currency ?? fundamentals?.currency ?? (market === "kr" ? "KRW" : "USD"),
      archivedAtMs: Date.now(),
      fundamentals,
      periods,
      statements,
    };
    writeSymbolFinancialArchive(sym, payload);
    return { ok: true, symbol: sym, statementCount: Object.keys(statements).length };
  });
}

/**
 * @param {Array<{ symbol: string }>} items
 * @param {number} limit
 * @param {(item: { symbol: string }) => Promise<{ ok: boolean; symbol: string; error?: string }>>} worker
 */
async function mapConcurrent(items, limit, worker) {
  /** @type {Promise<{ ok: boolean; symbol: string; error?: string }>[]>} */
  const results = [];
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      results[idx] = await worker(item);
      if (BATCH_DELAY_MS > 0) await delay(BATCH_DELAY_MS);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/**
 * @param {"kr"|"us"} market
 */
export async function runFinancialsArchiveForMarket(market) {
  const uni = await loadUniverse();
  const list = (market === "kr" ? uni.kr : uni.us).filter((row) => row?.symbol);
  const sessionKey = getTradingSessionKey(market);

  liveTradeLogInfo("[financials-archive] scan start", {
    market,
    symbols: list.length,
    sessionKey,
  });

  const started = Date.now();
  const results = await mapConcurrent(list, CONCURRENCY, async (row) => {
    try {
      return await archiveFinancialsForSymbol(row.symbol);
    } catch (e) {
      return {
        ok: false,
        symbol: row.symbol,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  const okCount = results.filter((r) => r?.ok).length;
  const failCount = results.length - okCount;

  const meta = readFinancialsArchiveMeta();
  meta[market] = {
    lastSessionKey: sessionKey,
    lastRunAtMs: Date.now(),
    symbolCount: list.length,
    okCount,
    failCount,
  };
  writeFinancialsArchiveMeta(meta);

  liveTradeLogInfo("[financials-archive] scan done", {
    market,
    sessionKey,
    ms: Date.now() - started,
    okCount,
    failCount,
  });

  if (failCount > 0) {
    liveTradeLogWarn("[financials-archive] partial failures", {
      market,
      failCount,
      sample: results.filter((r) => !r?.ok).slice(0, 5).map((r) => r?.symbol),
    });
  }

  return { market, sessionKey, symbolCount: list.length, okCount, failCount };
}
