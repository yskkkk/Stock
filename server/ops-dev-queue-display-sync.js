/**
 * display JSON = 메모리 FIFO 직렬 큐 미러 (+ enqueue 직전 lease 보조).
 */
import { getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";
import { writeDevQueueDisplayMirrorFromRuntime } from "./ops-dev-queue-live-store.js";

/** UI 폴링과 동일(100ms) — env로 조정 가능 */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 100);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 2000) : 100;
})();

let pollerStarted = false;

/** Vite HMR마다 모듈이 리로드되어도 디스크 미러를 매번 []로 지우지 않음 */
function isColdDevQueueMirrorBoot() {
  const g = /** @type {typeof globalThis & { __stockDevQueueMirrorBooted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueueMirrorBooted) return false;
  g.__stockDevQueueMirrorBooted = true;
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} runtimeEntries
 */
export function syncDevQueueDisplayFromRuntimeEntries(runtimeEntries) {
  const mem = Array.isArray(runtimeEntries) ? runtimeEntries : [];
  writeDevQueueDisplayMirrorFromRuntime(mem);
}

export function syncDevQueueDisplayFromRuntimeSync() {
  const { entries } = getOpsAgentQueueSnapshot();
  syncDevQueueDisplayFromRuntimeEntries(entries);
}

/** 큐 변경 직후 1회 — 폴링 틱을 기다리지 않음 */
export function requestDevQueueDisplaySyncNow() {
  syncDevQueueDisplayFromRuntimeSync();
}

/** 서버 기동 — 메모리 큐는 비어 있으므로 display 파일을 즉시 []에 맞춤 */
export function resetDevQueueDisplayMirrorOnBoot() {
  writeDevQueueDisplayMirrorFromRuntime([]);
}

export function startDevQueueDisplaySyncPoller() {
  if (process.env.STOCK_DEV_QUEUE_SYNC === "0") return;
  if (pollerStarted) return;
  pollerStarted = true;
  if (isColdDevQueueMirrorBoot()) {
    resetDevQueueDisplayMirrorOnBoot();
  } else {
    syncDevQueueDisplayFromRuntimeSync();
  }
  setInterval(syncDevQueueDisplayFromRuntimeSync, DEV_QUEUE_DISPLAY_SYNC_MS);
}
