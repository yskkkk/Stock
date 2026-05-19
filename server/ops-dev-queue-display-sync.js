/**
 * display JSON = 메모리 FIFO 미러(+ 디스크 lease, GET 이중 병합 없음).
 */
import { getOpsAgentQueueMemorySnapshot } from "./ops-agent-job-queue.js";
import {
  readDevQueueDisplaySnapshotSync,
  writeDevQueueDisplayMirrorFromRuntime,
} from "./ops-dev-queue-live-store.js";
import { mergeIdeLeaseDiskIntoAgentEntries } from "./ops-ide-lease-disk.js";

/** UI 폴링과 동일(1s) — env로 조정 가능 */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 1000);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 10_000) : 1000;
})();

let pollerStarted = false;
/** 프로세스 콜드 부트 직후 — 메모리 비어 있어도 디스크 미러를 즉시 비우지 않음 */
let bootPreserveDisplayDisk = false;

/** Vite HMR마다 모듈이 리로드되어도 디스크 미러를 매번 []로 지우지 않음 */
function isColdDevQueueMirrorBoot() {
  const g = /** @type {typeof globalThis & { __stockDevQueueMirrorBooted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueueMirrorBooted) return false;
  g.__stockDevQueueMirrorBooted = true;
  bootPreserveDisplayDisk = true;
  return true;
}

/**
 * @param {Array<Record<string, unknown>>} runtimeEntries
 */
export function syncDevQueueDisplayFromRuntimeEntries(runtimeEntries) {
  const mem = Array.isArray(runtimeEntries) ? runtimeEntries : [];
  writeDevQueueDisplayMirrorFromRuntime(mem);
}

function entriesForDisplayMirror() {
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  return mergeIdeLeaseDiskIntoAgentEntries(memory);
}

export function syncDevQueueDisplayFromRuntimeSync() {
  const entries = entriesForDisplayMirror();
  if (bootPreserveDisplayDisk && entries.length === 0) {
    const { agentEntries } = readDevQueueDisplaySnapshotSync();
    if (agentEntries.length > 0) return;
    bootPreserveDisplayDisk = false;
  }
  if (entries.length > 0) bootPreserveDisplayDisk = false;
  syncDevQueueDisplayFromRuntimeEntries(entries);
}

/** 큐 변경 직후 1회 — 폴링 틱을 기다리지 않음 */
export function requestDevQueueDisplaySyncNow() {
  syncDevQueueDisplayFromRuntimeSync();
}

/** 명시적 초기화(관리·복구) — 일반 재시작에서는 호출하지 않음 */
export function resetDevQueueDisplayMirrorOnBoot() {
  bootPreserveDisplayDisk = false;
  writeDevQueueDisplayMirrorFromRuntime([]);
}

export function startDevQueueDisplaySyncPoller() {
  if (process.env.STOCK_DEV_QUEUE_SYNC === "0") return;
  if (pollerStarted) return;
  pollerStarted = true;
  isColdDevQueueMirrorBoot();
  syncDevQueueDisplayFromRuntimeSync();
  setInterval(syncDevQueueDisplayFromRuntimeSync, DEV_QUEUE_DISPLAY_SYNC_MS);
}
