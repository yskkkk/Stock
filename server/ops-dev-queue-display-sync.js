/**
 * 하이브리드 display 동기화 — 메모리 FIFO 직렬 큐를 주기적으로
 * ops-dev-queue-display.json 에 미러(재시작 직후·완료 시 규칙 포함).
 */
import { getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";
import { writeDevQueueDisplayMirrorFromRuntime } from "./ops-dev-queue-live-store.js";

/** UI 폴링과 동일(100ms) — env로 조정 가능 */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 100);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 2000) : 100;
})();

let pollerStarted = false;
/** 이 프로세스에서 메모리 큐에 항목이 있었으면 true — 완료 후 [] 반영용 */
let sawRuntimeQueueThisProcess = false;

/**
 * @param {Array<Record<string, unknown>>} runtimeEntries
 */
export function syncDevQueueDisplayFromRuntimeEntries(runtimeEntries) {
  const mem = Array.isArray(runtimeEntries) ? runtimeEntries : [];
  if (mem.length > 0) sawRuntimeQueueThisProcess = true;
  writeDevQueueDisplayMirrorFromRuntime(mem, {
    preserveDiskWhenMemoryEmpty: !sawRuntimeQueueThisProcess,
  });
}

export function syncDevQueueDisplayFromRuntimeSync() {
  const { entries } = getOpsAgentQueueSnapshot();
  syncDevQueueDisplayFromRuntimeEntries(entries);
}

/** 큐 변경 직후 1회 — 폴링 틱을 기다리지 않음 */
export function requestDevQueueDisplaySyncNow() {
  syncDevQueueDisplayFromRuntimeSync();
}

export function startDevQueueDisplaySyncPoller() {
  if (process.env.STOCK_DEV_QUEUE_SYNC === "0") return;
  if (pollerStarted) return;
  pollerStarted = true;
  syncDevQueueDisplayFromRuntimeSync();
  setInterval(syncDevQueueDisplayFromRuntimeSync, DEV_QUEUE_DISPLAY_SYNC_MS);
}
