/**
 * 스캔 커버리지 폴러 — 원장 주기 갱신 + 누락 세션 as-of 백필(safety-net).
 *
 * - 주기적으로(기본 5분) 각 스캔 상태의 lastRuns 를 커버리지 원장에 병합.
 * - 부팅 후(다른 폴러가 자리 잡을 시간을 준 뒤) 원장 기준으로 「영업일이었는데 안 돈 스캔」을
 *   그 기준일(as-of)까지의 캔들로 재스캔. 이후 주기적으로도 점검(정규장 마감 후 누락분 포함).
 * - 실제 백필 로직은 scan-coverage-backfill.js. 최신 세션만 vault 병합, 과거는 원장/히스토리만.
 */

import {
  markPollerBootStarted,
  pollerGuardAsync,
  isPollerUserStopped,
} from "./poller-registry.js";
import { refreshScanCoverageLedger } from "./scan-coverage.js";
import { runScanCoverageBackfill } from "./scan-coverage-backfill.js";
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

// 누락 점검 주기(기본 30분) — 정규장 마감 후 안 돈 세션을 자동 backfill.
const BACKFILL_INTERVAL_MS = (() => {
  const n = Number(process.env.STOCK_SCAN_COVERAGE_BACKFILL_INTERVAL_MS ?? 1_800_000);
  return Number.isFinite(n) && n >= 300_000 ? Math.min(n, 21_600_000) : 1_800_000;
})();

export function scanCoverageEnabled() {
  return String(process.env.STOCK_SCAN_COVERAGE ?? "1").trim() !== "0";
}

/**
 * 부팅 backfill — 원장 기준 누락 세션을 as-of 로 재스캔(safety-net).
 * @param {{ reason?: string }} [opts]
 */
export async function runScanCoverageBootBackfill(opts = {}) {
  if (!scanCoverageEnabled() || isPollerUserStopped(POLLER_ID)) return { ran: 0, skipped: "off", targets: 0 };
  return runScanCoverageBackfill({ reason: opts.reason ?? "boot" });
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

  const backfill = (reason) => {
    if (isPollerUserStopped(POLLER_ID)) return;
    void runScanCoverageBackfill({ reason }).catch((e) =>
      liveTradeLogWarn(
        "[scan-coverage:backfill]",
        e instanceof Error ? e.message : e,
      ),
    );
  };

  liveTradeLogInfo("[scan-coverage:poller] start", {
    refreshMs: REFRESH_MS,
    backfillDelayMs: BOOT_BACKFILL_DELAY_MS,
    backfillIntervalMs: BACKFILL_INTERVAL_MS,
  });
  // 부팅 직후 원장 갱신 → (개별 폴러 자리 잡은 뒤) 누락 backfill → 이후 주기 점검.
  setTimeout(refresh, 15_000);
  setTimeout(() => backfill("boot"), BOOT_BACKFILL_DELAY_MS);
  setInterval(refresh, REFRESH_MS);
  setInterval(() => backfill("interval"), BACKFILL_INTERVAL_MS);
}
