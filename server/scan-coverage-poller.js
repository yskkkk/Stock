/**
 * 스캔 커버리지 폴러 — 원장 주기 갱신 + 부팅 시 「비어 있는 직전 세션」 재스캔(safety-net).
 *
 * - 주기적으로(기본 5분) 각 스캔 상태의 lastRuns 를 커버리지 원장에 병합.
 * - 부팅 후(다른 폴러가 자리 잡을 시간을 준 뒤) vault 스캔 작업 중 직전 정규장 세션이
 *   비어 있는 것이 있으면 기존 트리거로 재실행. 각 트리거는 실행 중 플래그로 중복 방지되므로
 *   개별 폴러가 이미 돌고 있으면 busy 로 건너뛴다(이중 실행 없음).
 */

import {
  markPollerBootStarted,
  pollerGuardAsync,
  isPollerUserStopped,
} from "./poller-registry.js";
import { refreshScanCoverageLedger } from "./scan-coverage.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const POLLER_ID = "scan-coverage";

const REFRESH_MS = (() => {
  const n = Number(process.env.STOCK_SCAN_COVERAGE_REFRESH_MS ?? 300_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 3_600_000) : 300_000;
})();

const BOOT_BACKFILL_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_SCAN_COVERAGE_BACKFILL_DELAY_MS ?? 120_000);
  return Number.isFinite(n) && n >= 10_000 ? Math.min(n, 900_000) : 120_000;
})();

export function scanCoverageEnabled() {
  return String(process.env.STOCK_SCAN_COVERAGE ?? "1").trim() !== "0";
}

/**
 * backfill 대상 — 각 스캔의 **정확한** due 판정(폴러와 동일)을 재사용해,
 * 직전 정규장 세션이 「마감 완료 + 미스캔」일 때만 트리거한다. 이렇게 하면
 * 장중에 오늘 날짜로 잘못 스캔되는 일이 없다. 트리거는 실행 중 플래그로 중복 방지.
 * @type {Array<{ id: string; pollerId: string; due: (now: Date) => Promise<boolean> | boolean; trigger: () => Promise<{ started?: boolean; reason?: string }> }>}
 */
const BACKFILL_TASKS = [
  {
    id: "vault",
    pollerId: "golden-cross",
    due: async (now) => {
      const m = await import("./golden-cross-poller.js");
      return m.shouldRunGoldenCrossScan("kr", now) || m.shouldRunGoldenCrossScan("us", now);
    },
    trigger: async () =>
      (await import("./golden-cross-poller.js")).triggerGoldenCrossManualScan(),
  },
  {
    id: "bottom-candle",
    pollerId: "bottom-candle",
    due: async (now) => {
      const m = await import("./bottom-candle-poller.js");
      return (
        m.shouldRunBottomCandleScan("kr", now) ||
        m.shouldRunBottomCandleScan("us", now)
      );
    },
    trigger: async () =>
      (await import("./bottom-candle-poller.js")).triggerBottomCandleManualScan(),
  },
  {
    id: "granville",
    pollerId: "granville",
    due: async (now) => {
      const m = await import("./granville-poller.js");
      return (
        m.dueGranvilleScanDate("kr", now) != null ||
        m.dueGranvilleScanDate("us", now) != null
      );
    },
    trigger: async () =>
      (await import("./granville-poller.js")).triggerGranvilleManualScan(),
  },
];

/**
 * 부팅 backfill — 직전 정규장 세션이 비어 있는 vault 스캔을 재실행(safety-net).
 * @param {Date} [now]
 */
export async function runScanCoverageBootBackfill(now = new Date()) {
  if (!scanCoverageEnabled() || isPollerUserStopped(POLLER_ID)) return [];
  /** @type {Array<{ id: string; started: boolean; reason: string | null }>} */
  const triggered = [];
  for (const task of BACKFILL_TASKS) {
    if (isPollerUserStopped(task.pollerId)) continue;
    let isDue = false;
    try {
      isDue = await task.due(now);
    } catch {
      continue;
    }
    if (!isDue) continue;
    try {
      const r = await task.trigger();
      triggered.push({
        id: task.id,
        started: Boolean(r?.started),
        reason: r?.reason ?? null,
      });
      if (r?.started) {
        liveTradeLogInfo("[scan-coverage:backfill] triggered", { task: task.id });
      }
    } catch (e) {
      liveTradeLogWarn(
        "[scan-coverage:backfill]",
        task.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return triggered;
}

export function startScanCoverageLedgerPoller() {
  if (!scanCoverageEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockScanCoverage?: boolean }} */ (
    globalThis
  );
  if (g.__stockScanCoverage) return;
  g.__stockScanCoverage = true;
  markPollerBootStarted(POLLER_ID);

  const refresh = () => {
    if (isPollerUserStopped(POLLER_ID)) return;
    void pollerGuardAsync(POLLER_ID, () => refreshScanCoverageLedger()).catch(
      (e) =>
        liveTradeLogWarn(
          "[scan-coverage:refresh]",
          e instanceof Error ? e.message : e,
        ),
    );
  };

  liveTradeLogInfo("[scan-coverage:poller] start", {
    refreshMs: REFRESH_MS,
    backfillDelayMs: BOOT_BACKFILL_DELAY_MS,
  });
  // 부팅 직후 한 번 원장 갱신, 이후 backfill(개별 폴러가 자리 잡은 뒤).
  setTimeout(refresh, 15_000);
  setTimeout(() => {
    void runScanCoverageBootBackfill().catch(() => {});
  }, BOOT_BACKFILL_DELAY_MS);
  setInterval(refresh, REFRESH_MS);
}
