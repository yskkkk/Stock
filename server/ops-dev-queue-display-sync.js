/**
 * 하이브리드 #3 — display JSON = 메모리 FIFO 미러(평소 전체 sync).
 * - 재시작: stale·이력 정리 후 메모리(보통 [])로 파일 덮음 — 디스크 잔상은 고아
 * - 훅 release: 메모리·lease 해제 → 다음 sync 틱에 파일 반영
 * - enqueue 직전: 메모리 비었을 때만 lease를 1회 미러에 병합(깜빡임 방지)
 */
import {
  getOpsAgentQueueMemorySnapshot,
  recoverIdeDevQueueFromPersistedState,
} from "./ops-agent-job-queue.js";
import {
  clearOrphanDevQueueDisplayOnBootSync,
  sweepStalePersistedDevQueueSync,
  writeDevQueueDisplayMirrorFromRuntime,
} from "./ops-dev-queue-live-store.js";
import {
  clearIdeLeaseOnDisk,
  clearOrphanIdeLeaseIfNeeded,
  mergeIdeLeaseDiskIntoAgentEntries,
} from "./ops-ide-lease-disk.js";
import { markPollerBootStarted, pollerGuardSync } from "./poller-registry.js";

/** UI 폴링과 맞춤 — 기본 250ms(과거 100ms). `STOCK_DEV_QUEUE_SYNC_MS` */
export const DEV_QUEUE_DISPLAY_SYNC_MS = (() => {
  const raw = Number(process.env.STOCK_DEV_QUEUE_SYNC_MS ?? 250);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(raw, 10_000) : 250;
})();

/** Vite server.restart() 시 모듈이 다시 로드되므로 globalThis 사용 */
function pollerAlreadyStarted() {
  const g = /** @type {typeof globalThis & { __stockDevQueuePollerStarted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueuePollerStarted) return true;
  g.__stockDevQueuePollerStarted = true;
  return false;
}

const _g = /** @type {typeof globalThis & { __stockLastStaleLeasCheckMs?: number; __stockDevQueueSyncFn?: () => void }} */ (globalThis);
if (_g.__stockLastStaleLeasCheckMs == null) _g.__stockLastStaleLeasCheckMs = 0;
const STALE_LEASE_CHECK_INTERVAL_MS = 1_000;

function isColdDevQueueMirrorBoot() {
  const g = /** @type {typeof globalThis & { __stockDevQueueMirrorBooted?: boolean }} */ (
    globalThis
  );
  if (g.__stockDevQueueMirrorBooted) return false;
  g.__stockDevQueueMirrorBooted = true;
  return true;
}

/**
 * 메모리 FIFO + 디스크 lease(훅·transcript 선등록) — 항상 병합.
 * @returns {Array<Record<string, unknown>>}
 */
function entriesForDisplayMirror() {
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();

  const now = Date.now();
  if (now - (_g.__stockLastStaleLeasCheckMs ?? 0) >= STALE_LEASE_CHECK_INTERVAL_MS) {
    _g.__stockLastStaleLeasCheckMs = now;
    clearOrphanIdeLeaseIfNeeded(memory);
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

/** release 직후: 미러를 먼저 비워 display→메모리 재복구 레이스 차단 */
export function forceClearDevQueueDisplayMirrorSync() {
  writeDevQueueDisplayMirrorFromRuntime([]);
}

/** @deprecated no-op — 과거 bootPreserve 해제용, 호출부 호환만 유지 */
export function releaseDevQueueDisplayPreserve() {}

/**
 * 서버 콜드 부트 — stale·이력 정리 후 메모리→파일(메모리 비면 []).
 */
export function reconcileDevQueueDisplayMirrorOnBoot() {
  sweepStalePersistedDevQueueSync();
  const { entries: memory } = getOpsAgentQueueMemorySnapshot();
  if (memory.length === 0) {
    const { recovered } = recoverIdeDevQueueFromPersistedState();
    if (recovered === 0) {
      clearOrphanDevQueueDisplayOnBootSync();
      clearIdeLeaseOnDisk();
    }
  }
  syncDevQueueDisplayFromRuntimeSync();
}

/** 명시적 초기화(관리·복구용) */
export function resetDevQueueDisplayMirrorOnBoot() {
  writeDevQueueDisplayMirrorFromRuntime([]);
}

export function startDevQueueDisplaySyncPoller() {
  if (process.env.STOCK_DEV_QUEUE_SYNC === "0") return;
  // HMR 리로드 시에도 항상 최신 함수로 교체 — 기존 setInterval이 이걸 통해 호출
  _g.__stockDevQueueSyncFn = syncDevQueueDisplayFromRuntimeSync;
  if (pollerAlreadyStarted()) return;
  if (isColdDevQueueMirrorBoot()) {
    reconcileDevQueueDisplayMirrorOnBoot();
  }
  syncDevQueueDisplayFromRuntimeSync();
  markPollerBootStarted("dev-queue-sync");
  setInterval(() => {
    try {
      pollerGuardSync("dev-queue-sync", () => {
        _g.__stockDevQueueSyncFn?.();
      });
    } catch {
      /* ignore */
    }
  }, DEV_QUEUE_DISPLAY_SYNC_MS);
}
