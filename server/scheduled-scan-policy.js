/**
 * 스케줄 스캔 일괄 실행 정책 — 사용자 중지 vs 장애 복구 구분
 */
import { bottomCandleScanEnabled } from "./bottom-candle-poller.js";
import { bookAccumFastScanEnabled } from "./book-accumulation-fast-scan.js";
import {
  goldenCrossScanEnabled,
  shouldRunGoldenCrossScan,
} from "./golden-cross-poller.js";
import {
  isPollerUserStopped,
  listUserStoppedPollerIdsSync,
} from "./poller-registry.js";
import { getBottomCandleScanStateSync } from "./bottom-candle-scan.js";
import {
  granvilleScanEnabled,
  dueGranvilleScanDate,
} from "./granville-poller.js";
import { getKstParts } from "./kr-business-day.js";

/** @typedef {{
 *   id: string;
 *   label: string;
 *   pollerIds?: string[];
 *   isConfiguredEnabled: () => boolean;
 *   shouldRecover?: (now?: Date) => boolean | Promise<boolean>;
 * }} ScheduledScanTask */

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** @param {string[]} pollerIds */
function anyPollerUserStopped(pollerIds) {
  return pollerIds.some((id) => isPollerUserStopped(id));
}

function bottomCandleNeedsRecovery(now = new Date()) {
  const st = getBottomCandleScanStateSync();
  const krDate = getKstParts(now).dateKey;
  const usDate = localUsDateKey(now);
  return (
    st.krLastScanDate !== krDate ||
    st.usLastScanDate !== usDate ||
    st.krWeeklyLastScanDate !== krDate ||
    st.usWeeklyLastScanDate !== usDate
  );
}

/** @type {ScheduledScanTask[]} */
export const SCHEDULED_SCAN_TASKS = [
  {
    id: "vault",
    label: "vault(golden-cross·정배열·120·저점기울기·매집)",
    pollerIds: ["golden-cross"],
    isConfiguredEnabled: () => goldenCrossScanEnabled(),
    shouldRecover: (now = new Date()) =>
      shouldRunGoldenCrossScan("kr", now) || shouldRunGoldenCrossScan("us", now),
  },
  {
    id: "bottom-candle",
    label: "bottom-candle",
    pollerIds: ["bottom-candle"],
    isConfiguredEnabled: () => bottomCandleScanEnabled(),
    shouldRecover: bottomCandleNeedsRecovery,
  },
  {
    id: "granville",
    label: "granville(그랜빌 8법칙·매수)",
    pollerIds: ["granville"],
    isConfiguredEnabled: () => granvilleScanEnabled(),
    shouldRecover: (now = new Date()) =>
      dueGranvilleScanDate("kr", now) != null ||
      dueGranvilleScanDate("us", now) != null,
  },
  {
    id: "book-accum-fast",
    label: "book-accum-fast(kr+us)",
    isConfiguredEnabled: () => bookAccumFastScanEnabled(),
    shouldRecover: () => true,
  },
];

/** @param {ScheduledScanTask} task */
export function scheduledScanUserStopReason(task) {
  if (!task.isConfiguredEnabled()) {
    return "env-off";
  }
  const pollers = task.pollerIds ?? [];
  if (pollers.length && anyPollerUserStopped(pollers)) {
    return "poller-user-stop";
  }
  return null;
}

/** @param {ScheduledScanTask} task @param {Date} [now] */
export async function shouldRecoverScheduledScan(task, now = new Date()) {
  const stopReason = scheduledScanUserStopReason(task);
  if (stopReason) return { run: false, stopReason };

  const recoverFn = task.shouldRecover ?? (() => true);
  const needs = await recoverFn(now);
  if (!needs) return { run: false, stopReason: "already-complete" };
  return { run: true, stopReason: null };
}

/** @param {Date} [now] */
export async function listScheduledScanRecoveryPlan(now = new Date()) {
  /** @type {Array<{ id: string; label: string; run: boolean; stopReason: string | null }>} */
  const rows = [];
  for (const task of SCHEDULED_SCAN_TASKS) {
    const decision = await shouldRecoverScheduledScan(task, now);
    rows.push({
      id: task.id,
      label: task.label,
      run: decision.run,
      stopReason: decision.stopReason,
    });
  }
  return rows;
}

/** 일괄 스캔 SSOT — 종목보관(vault) 관련만 */
export const VAULT_SCHEDULED_SCAN_TASK_IDS = [
  "vault",
  "bottom-candle",
  "granville",
  "book-accum-fast",
];

/** force-enable로 잘못 돌았을 가능성이 있었던 opt-in 스캔(현재 일괄 목록에 없음) */
export const OPT_IN_SCAN_TASK_IDS = [];

/** 사용자가 도크에서 끈 폴러 — all-scans 후 재기동됐을 수 있음 */
export const INTRADAY_POLLER_IDS = [
  "golden-cross-intraday",
  "ma120-near-watch",
];

export function listUserStoppedPollersForReport() {
  return listUserStoppedPollerIdsSync();
}
