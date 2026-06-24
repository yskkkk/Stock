/**
 * 스케줄 스캔 일괄 실행 정책 — 사용자 중지 vs 장애 복구 구분
 */
import { boxRangeDetectEnabled } from "./box-range/constants.js";
import { bottomCandleScanEnabled } from "./bottom-candle-poller.js";
import { bookAccumFastScanEnabled } from "./book-accumulation-fast-scan.js";
import {
  goldenCrossScanEnabled,
  shouldRunGoldenCrossScan,
} from "./golden-cross-poller.js";
import { krInvestorFlowEnabled } from "./kr-investor-flow.js";
import { financialsArchiveEnabled } from "./stock-financials-archive-schedule.js";
import { shareStructureScanEnabled } from "./stock-share-structure-schedule.js";
import { screeningPollerEnabled } from "./screener.js";
import {
  isPollerUserStopped,
  listUserStoppedPollerIdsSync,
} from "./poller-registry.js";
import { getBottomCandleScanStateSync } from "./bottom-candle-scan.js";
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
    id: "book-accum-fast",
    label: "book-accum-fast(kr+us)",
    isConfiguredEnabled: () => bookAccumFastScanEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "box-us",
    label: "box-us",
    pollerIds: ["box-sp500-scan"],
    isConfiguredEnabled: () =>
      boxRangeDetectEnabled() &&
      process.env.STOCK_BOX_RANGE_SP500_SCAN !== "0",
  },
  {
    id: "box-kr",
    label: "box-kr",
    pollerIds: ["box-kr-scan"],
    isConfiguredEnabled: () =>
      boxRangeDetectEnabled() &&
      process.env.STOCK_BOX_RANGE_KR_SCAN !== "0",
  },
  {
    id: "kr-investor-flow",
    label: "kr-investor-flow",
    pollerIds: ["kr-investor-flow"],
    isConfiguredEnabled: () => krInvestorFlowEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "financials-kr",
    label: "financials-kr",
    pollerIds: ["financials-archive"],
    isConfiguredEnabled: () => financialsArchiveEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "financials-us",
    label: "financials-us",
    pollerIds: ["financials-archive"],
    isConfiguredEnabled: () => financialsArchiveEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "share-structure-kr",
    label: "share-structure-kr",
    pollerIds: ["share-structure"],
    isConfiguredEnabled: () => shareStructureScanEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "share-structure-us",
    label: "share-structure-us",
    pollerIds: ["share-structure"],
    isConfiguredEnabled: () => shareStructureScanEnabled(),
    shouldRecover: () => true,
  },
  {
    id: "screener",
    label: "screener",
    pollerIds: ["screener"],
    isConfiguredEnabled: () => screeningPollerEnabled(),
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

/** force-enable로 잘못 돌았을 가능성이 큰 opt-in 스캔 */
export const OPT_IN_SCAN_TASK_IDS = ["box-us", "box-kr", "screener"];

/** 사용자가 도크에서 끈 폴러 — all-scans 후 재기동됐을 수 있음 */
export const INTRADAY_POLLER_IDS = [
  "golden-cross-intraday",
  "ma120-near-watch",
];

export function listUserStoppedPollersForReport() {
  return listUserStoppedPollerIdsSync();
}
