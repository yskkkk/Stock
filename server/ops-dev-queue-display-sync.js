/**
 * 하이브리드 #3 — display JSON = 메모리 FIFO 미러(평소 전체 sync).
 * - 재시작: 파일에 running/waiting 있으면 이력·stale 정리만, 무조건 [] 아님
 * - 훅 release: 메모리·lease 해제 → 다음 sync 틱에 파일 반영
 * - enqueue 직전: 메모리 비었을 때만 lease를 1회 미러에 병합(깜빡임 방지)
 */
import { getOpsAgentQueueMemorySnapshot } from "./ops-agent-job-queue.js";
import {
  readDevQueueLiveAgentEntriesSync,
  reconcilePersistQueueToAgentHistorySync,
  sweepStalePersistedDevQueueSync,
  writeDevQueueDisplayMirrorFromRuntime,
} from "./ops-dev-queue-live-store.js";
import { mergeIdeLeaseDiskIntoAgentEntries } from "./ops-ide-lease-disk.js";

/** UI 폴링과 동일(1s) — env로 조정 가능 */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 1000);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 10_000) : 1000;
})();

let pollerStarted = false;

/** 재시작 직후: 메모리 비어 있어도 디스크에 active 행이 있으면 sync로 [] 덮지 않음 */
let bootPreserveDisplayDisk = false;

function isColdDevQueueMirrorBoot() {
  const g = /** @type {typeof globalThis & { __stockDevQueueMirrorBooted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueueMirrorBooted) return false;
  g.__stockDevQueueMirrorBooted = true;
  return true;
}

function diskHasActiveQueueEntries() {
  return readDevQueueLiveAgentEntriesSync().some((e) => {
    const st = String(e.status ?? "");
    return st === "running" || st === "waiting";
  });
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
function entriesForDisplayMirror() {
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  if (memoryHasIdeWork(memory)) return memory;
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
  const entries = entriesForDisplayMirror();
  if (bootPreserveDisplayDisk && entries.length === 0) {
    return;
  }
  if (entries.length > 0) bootPreserveDisplayDisk = false;
  syncDevQueueDisplayFromRuntimeEntries(entries);
}

/** 큐 변경·release 직후 — preserve 해제 후 즉시 메모리→파일 */
export function requestDevQueueDisplaySyncNow() {
  syncDevQueueDisplayFromRuntimeSync();
}

/** release·완료 후 다음 sync에서 파일을 비울 수 있게 */
export function releaseDevQueueDisplayPreserve() {
  bootPreserveDisplayDisk = false;
}

/**
 * 서버 콜드 부트 — 무조건 [] 금지. active 잔상이 있으면 이력·stale만 정리.
 */
export function reconcileDevQueueDisplayMirrorOnBoot() {
  sweepStalePersistedDevQueueSync();
  reconcilePersistQueueToAgentHistorySync();

  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  if (memory.length > 0) {
    bootPreserveDisplayDisk = false;
    syncDevQueueDisplayFromRuntimeSync();
    return;
  }

  if (diskHasActiveQueueEntries()) {
    bootPreserveDisplayDisk = true;
    return;
  }

  bootPreserveDisplayDisk = false;
  writeDevQueueDisplayMirrorFromRuntime([]);
}

/** 명시적 초기화(관리·복구용) */
export function resetDevQueueDisplayMirrorOnBoot() {
  bootPreserveDisplayDisk = false;
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
