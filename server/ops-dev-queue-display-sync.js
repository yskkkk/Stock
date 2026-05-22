/**
 * 하이브리드 #3 — display JSON = 메모리 FIFO 미러(평소 전체 sync).
 * - 재시작: stale·이력 정리 후 메모리(보통 [])로 파일 덮음 — 디스크 잔상은 고아
 * - 훅 release: 메모리·lease 해제 → 다음 sync 틱에 파일 반영
 * - enqueue 직전: 메모리 비었을 때만 lease를 1회 미러에 병합(깜빡임 방지)
 */
import { getOpsAgentQueueMemorySnapshot } from "./ops-agent-job-queue.js";
import {
  collapseIdeAgentHistoryDuplicatesSync,
  finalizeOrphanIdeAgentHistoryOnBootSync,
} from "./ops-agent-history-store.js";
import {
  clearOrphanDevQueueDisplayOnBootSync,
  reconcilePersistQueueToAgentHistorySync,
  sweepStalePersistedDevQueueSync,
  writeDevQueueDisplayMirrorFromRuntime,
} from "./ops-dev-queue-live-store.js";
import {
  clearIdeLeaseOnDisk,
  mergeIdeLeaseDiskIntoAgentEntries,
  readIdeLeaseDiskSync,
} from "./ops-ide-lease-disk.js";

/** UI 폴링과 맞춤(기본 100ms) — `STOCK_DEV_QUEUE_SYNC_MS` */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 100);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 10_000) : 100;
})();

let pollerStarted = false;

function isColdDevQueueMirrorBoot() {
  const g = /** @type {typeof globalThis & { __stockDevQueueMirrorBooted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueueMirrorBooted) return false;
  g.__stockDevQueueMirrorBooted = true;
  return true;
}

/** @param {Array<Record<string, unknown>>} memory */
function memoryHasIdeWork(memory) {
  return memory.some(
    (e) => e.source === "ide" || e.requestIp === "cursor-ide",
  );
}

/**
 * 평소: 메모리만. enqueue 직전(메모리에 IDE 없고 lease만 있을 때)만 lease 병합.
 * @returns {Array<Record<string, unknown>>}
 */
/** enqueue 직전 lease만 — 오래된 lease는 고아로 제거 */
function entriesForDisplayMirror() {
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  if (memoryHasIdeWork(memory)) return memory;
  const lease = readIdeLeaseDiskSync();
  if (lease) {
    const since =
      typeof lease.sinceMs === "number"
        ? lease.sinceMs
        : typeof lease.enqueuedAtMs === "number"
          ? lease.enqueuedAtMs
          : 0;
    if (since > 0 && Date.now() - since > 120_000) {
      clearIdeLeaseOnDisk();
      return memory;
    }
  }
  return mergeIdeLeaseDiskIntoAgentEntries(memory);
}

/**
 * @param {Array<Record<string, unknown>>} runtimeEntries
 */
export function syncDevQueueDisplayFromRuntimeEntries(runtimeEntries) {
  const mem = Array.isArray(runtimeEntries) ? runtimeEntries : [];
  writeDevQueueDisplayMirrorFromRuntime(mem);
}

export function syncDevQueueDisplayFromRuntimeSync() {
  syncDevQueueDisplayFromRuntimeEntries(entriesForDisplayMirror());
}

/** 큐 변경·release 직후 즉시 메모리→파일 */
export function requestDevQueueDisplaySyncNow() {
  syncDevQueueDisplayFromRuntimeSync();
}

/** @deprecated no-op — 과거 bootPreserve 해제용, 호출부 호환만 유지 */
export function releaseDevQueueDisplayPreserve() {}

/**
 * 서버 콜드 부트 — stale·이력 정리 후 메모리→파일(메모리 비면 []).
 */
export function reconcileDevQueueDisplayMirrorOnBoot() {
  sweepStalePersistedDevQueueSync();
  collapseIdeAgentHistoryDuplicatesSync();
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  if (memory.length === 0) {
    clearOrphanDevQueueDisplayOnBootSync();
    clearIdeLeaseOnDisk();
    finalizeOrphanIdeAgentHistoryOnBootSync();
  }
  reconcilePersistQueueToAgentHistorySync();
  syncDevQueueDisplayFromRuntimeSync();
}

/** 명시적 초기화(관리·복구용) */
export function resetDevQueueDisplayMirrorOnBoot() {
  writeDevQueueDisplayMirrorFromRuntime([]);
}

export function startDevQueueDisplaySyncPoller() {
  if (process.env.STOCK_DEV_QUEUE_SYNC === "0") return;
  if (pollerStarted) return;
  pollerStarted = true;
  if (isColdDevQueueMirrorBoot()) {
    reconcileDevQueueDisplayMirrorOnBoot();
  }
  syncDevQueueDisplayFromRuntimeSync();
  setInterval(syncDevQueueDisplayFromRuntimeSync, DEV_QUEUE_DISPLAY_SYNC_MS);
}
