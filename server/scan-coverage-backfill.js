/**
 * 스캔 커버리지 백필 엔진 — 원장 기준으로 「영업일이었는데 안 돈 스캔」을 찾아
 * 그 날짜(as-of)까지의 캔들만으로 재스캔한다. (실제 그날 점검한 것처럼)
 *
 * 규칙:
 *  - 대상: 최근 N 영업일 중 「정규장 마감 완료 + 원장 미기록」인 (source, market, tf, date).
 *  - as-of: 각 run…MarketScan 에 asOf(=date)를 넘겨 그 기준일까지만 캔들 계산.
 *  - vault 병합: 시장별 「최신 완료 세션」(latest)일 때만 clear+merge (현재 보관함 최신 유지).
 *               과거 세션은 원장(+히스토리)에만 기록해 달력을 채우고 보관함은 건드리지 않음.
 *  - 상태 포인터: 최신 세션 백필만 persistState=true(폴러가 「이미 돌았다」고 인식 → 중복 방지).
 *               과거 세션은 persistState=false + 원장 직접 기록(latest 포인터를 뒤로 되돌리지 않음).
 *  - 부하 제한: 한 번의 백필에서 MAX_TARGETS 개만 처리(나머지는 다음 주기에). 순차 실행.
 */

import {
  getScanBackfillTargetsSync,
  recordScanCoverageRunSync,
  refreshScanCoverageLedger,
} from "./scan-coverage.js";
import { assessScanVaultMerge, applyVaultScanMerge } from "./scan-vault-merge.js";
import { isPollerUserStopped } from "./poller-registry.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const BACKFILL_DAYS = (() => {
  const n = Number(process.env.STOCK_SCAN_COVERAGE_BACKFILL_DAYS ?? 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 60) : 10;
})();

const MAX_TARGETS = (() => {
  const n = Number(process.env.STOCK_SCAN_COVERAGE_BACKFILL_MAX ?? 24);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 200) : 24;
})();

/**
 * 소스별 백필 핸들러. run→결과, mergeVault→최신 세션 병합, appendHistory→날짜별 스냅샷.
 * @type {Record<string, {
 *   run: (market: "kr"|"us", date: string, timeframe: "1d"|"1wk", persistState: boolean) => Promise<any>;
 *   mergeVault: (market: "kr"|"us", timeframe: "1d"|"1wk", result: any) => Promise<void>;
 *   appendHistory?: (market: "kr"|"us", timeframe: "1d"|"1wk", date: string, result: any) => Promise<void>;
 * }>}
 */
const HANDLERS = {
  golden_cross: {
    run: async (market, date, tf, persistState) =>
      (await import("./golden-cross-scan.js")).runGoldenCrossMarketScan(market, date, {
        timeframe: tf,
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: result.scanned,
          hitCount: result.hitCount,
          errors: result.errors ?? 0,
        }),
        {
          clear: () => s.clearGoldenCrossVaultItemsSync({ market, timeframe: tf }),
          merge: (hits) => s.mergeGoldenCrossHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
    appendHistory: async (market, tf, date, result) => {
      (await import("./golden-cross-history-store.js")).appendGoldenCrossHistoryEntrySync({
        trigger: "scheduled",
        market,
        scanDate: date,
        timeframe: tf,
        scanned: result.scanned,
        hits: result.hits,
      });
    },
  },
  ma_align: {
    run: async (market, date, tf, persistState) =>
      (await import("./ma-align-scan.js")).runMaAlignMarketScan(market, date, {
        timeframe: tf,
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({ scanned: result.scanned, hitCount: result.hitCount }),
        {
          clear: () => s.clearMaAlignVaultItemsSync({ market, timeframe: tf }),
          merge: (hits) => s.mergeMaAlignHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
    appendHistory: async (market, tf, date, result) => {
      (await import("./ma-align-history-store.js")).appendMaAlignHistoryEntrySync({
        trigger: "scheduled",
        market,
        scanDate: date,
        timeframe: tf,
        scanned: result.scanned,
        hits: result.hits,
      });
    },
  },
  ma120_near: {
    run: async (market, date, _tf, persistState) =>
      (await import("./ma120-near-scan.js")).runMa120NearMarketScan(market, date, {
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, _tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({ scanned: result.scanned, hitCount: result.hitCount }),
        {
          clear: () => s.clearMa120NearVaultItemsSync({ market }),
          merge: (hits) => s.mergeMa120NearHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
    appendHistory: async (market, _tf, date, result) => {
      (await import("./ma120-near-history-store.js")).appendMa120NearHistoryEntrySync({
        trigger: "scheduled",
        market,
        scanDate: date,
        scanned: result.scanned,
        hits: result.hits,
      });
    },
  },
  low_slope_flip: {
    // 실제 스캔은 주봉(1wk)이지만 상태에 timeframe 필드가 없어 원장은 "1d" 키.
    run: async (market, date, _tf, persistState) =>
      (await import("./candle-low-slope-scan.js")).runCandleLowSlopeMarketScan(market, date, {
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, _tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({ scanned: result.scanned, hitCount: result.hitCount }),
        {
          clear: () => s.clearLowSlopeFlipVaultItemsSync({ market }),
          merge: (hits) => s.mergeLowSlopeFlipHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
  },
  book_accum: {
    run: async (market, date, tf, persistState) =>
      (await import("./book-accumulation-scan.js")).runBookAccumulationMarketScan(market, date, {
        timeframe: tf,
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: result.scanned,
          hitCount: result.hitCount,
          errors: result.errors ?? 0,
        }),
        {
          clear: () => s.clearBookAccumVaultItemsSync({ market, timeframe: tf }),
          merge: (hits) => s.mergeBookAccumHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
  },
  bottom_candle: {
    run: async (market, date, tf, persistState) =>
      (await import("./bottom-candle-scan.js")).runBottomCandleMarketScan(market, date, {
        timeframe: tf,
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: result.scanned,
          hitCount: result.hitCount,
          errors: result.errors ?? 0,
        }),
        {
          clear: () => s.clearBottomCandleVaultItemsSync({ market, timeframe: tf }),
          merge: (hits) => s.mergeBottomCandleHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
  },
  granville: {
    run: async (market, date, _tf, persistState) =>
      (await import("./granville-scan.js")).runGranvilleMarketScan(market, date, {
        asOf: date,
        persistState,
      }),
    mergeVault: async (market, _tf, result) => {
      const s = await import("./stock-vault-store.js");
      applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: result.scanned,
          hitCount: result.hitCount,
          errors: result.errors ?? 0,
        }),
        {
          clear: () => s.clearGranvilleVaultItemsSync({ market }),
          merge: (hits) => s.mergeGranvilleHitsIntoVaultSync(hits),
        },
        result.hits,
      );
    },
  },
};

let backfillRunning = false;

/**
 * 현재 vault/개별 스캔이 돌고 있으면 백필을 미룬다(동시 vault 파일 쓰기 EPERM 방지).
 */
async function anyVaultScanRunning() {
  try {
    const gc = await import("./golden-cross-poller.js");
    if (typeof gc.isVaultMarketScanRunning === "function" && gc.isVaultMarketScanRunning())
      return true;
  } catch {}
  try {
    const bc = await import("./bottom-candle-poller.js");
    if (typeof bc.isBottomCandleScanRunning === "function" && bc.isBottomCandleScanRunning())
      return true;
  } catch {}
  try {
    const gv = await import("./granville-poller.js");
    if (typeof gv.isGranvilleScanRunning === "function" && gv.isGranvilleScanRunning())
      return true;
  } catch {}
  return false;
}

/**
 * 커버리지 백필 실행 — 원장의 누락 세션을 as-of 로 재스캔.
 * @param {{ maxTargets?: number; days?: number; reason?: string }} [opts]
 * @returns {Promise<{ ran: number; skipped: string | null; targets: number }>}
 */
export async function runScanCoverageBackfill(opts = {}) {
  if (isPollerUserStopped("scan-coverage")) return { ran: 0, skipped: "user-stop", targets: 0 };
  if (backfillRunning) return { ran: 0, skipped: "busy", targets: 0 };
  if (await anyVaultScanRunning()) return { ran: 0, skipped: "vault-scan-running", targets: 0 };

  backfillRunning = true;
  try {
    await refreshScanCoverageLedger().catch(() => {});
    const days = Number(opts.days) || BACKFILL_DAYS;
    const { latest, targets } = getScanBackfillTargetsSync({ days });
    if (!targets.length) return { ran: 0, skipped: null, targets: 0 };

    // 최신 세션(vault 병합 대상) 먼저, 그 다음 과거 세션. 상한까지만.
    const ordered = [...targets].sort((a, b) => {
      if (a.isLatest !== b.isLatest) return a.isLatest ? -1 : 1;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    const cap = Math.min(Number(opts.maxTargets) || MAX_TARGETS, ordered.length);
    const batch = ordered.slice(0, cap);

    liveTradeLogInfo("[scan-coverage:backfill] start", {
      reason: opts.reason ?? "auto",
      total: targets.length,
      running: batch.length,
      latest,
    });

    let ran = 0;
    for (const t of batch) {
      const handler = HANDLERS[t.source];
      if (!handler) continue;
      const persistState = t.isLatest; // 최신만 상태 포인터 이동
      try {
        const result = await handler.run(t.market, t.date, t.timeframe, persistState);
        if (t.isLatest) {
          await handler.mergeVault(t.market, t.timeframe, result).catch((e) =>
            liveTradeLogWarn("[scan-coverage:backfill:merge]", t.source, t.market, e?.message ?? e),
          );
        }
        if (handler.appendHistory) {
          await handler
            .appendHistory(t.market, t.timeframe, t.date, result)
            .catch(() => {});
        }
        recordScanCoverageRunSync(t.source, t.market, t.timeframe, t.date);
        ran += 1;
        liveTradeLogInfo("[scan-coverage:backfill] done", {
          source: t.source,
          market: t.market,
          tf: t.timeframe,
          date: t.date,
          isLatest: t.isLatest,
          hits: result?.hitCount ?? 0,
        });
      } catch (e) {
        liveTradeLogWarn(
          "[scan-coverage:backfill] fail",
          t.source,
          t.market,
          t.timeframe,
          t.date,
          e instanceof Error ? e.message : e,
        );
      }
    }
    return { ran, skipped: null, targets: targets.length };
  } finally {
    backfillRunning = false;
  }
}
