/**
 * 개발 대기열 **영속 상태** — server/.data/ops-dev-queue-display.json
 * 작업 등록·실행·완료 시 즉시 upsert/remove (메모리·dev 재시작과 무관).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeIdeLeaseIntoDisplayEntries } from "./ops-ide-lease-disk.js";
import { upsertOpsAgentHistoryFromQueueSync } from "./ops-agent-history-store.js";
import { enrichAgentEntriesWithUnifiedSeq } from "./ops-unified-queue-seq.js";

const RECORD_MODE_REQUEST_IP = "record-mode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
export const DEV_QUEUE_LIVE_FILE = path.join(DATA_DIR, "ops-dev-queue-display.json");

/** @type {{ updatedAtMs: number; agentEntries: Array<Record<string, unknown>> } | null} */
let memoryLive = null;

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** @param {unknown} parsed */
function normalizeLive(parsed) {
  if (!isPlainObject(parsed)) {
    return { updatedAtMs: 0, agentEntries: [] };
  }
  const updatedAtMs =
    typeof parsed.updatedAtMs === "number" && Number.isFinite(parsed.updatedAtMs)
      ? parsed.updatedAtMs
      : 0;
  const agentEntries = Array.isArray(parsed.agentEntries) ? parsed.agentEntries : [];
  return { updatedAtMs, agentEntries };
}

function loadLiveFromDiskSync() {
  try {
    if (!fs.existsSync(DEV_QUEUE_LIVE_FILE)) {
      return { updatedAtMs: 0, agentEntries: [] };
    }
    return normalizeLive(JSON.parse(fs.readFileSync(DEV_QUEUE_LIVE_FILE, "utf8")));
  } catch {
    return { updatedAtMs: 0, agentEntries: [] };
  }
}

/** @returns {{ updatedAtMs: number; agentEntries: Array<Record<string, unknown>> }} */
function readLiveRawSync() {
  if (!memoryLive) memoryLive = loadLiveFromDiskSync();
  return memoryLive;
}

/**
 * @param {{ updatedAtMs: number; agentEntries: Array<Record<string, unknown>> }} live
 */
function writeLiveRawSync(live) {
  const payload = {
    updatedAtMs: Date.now(),
    agentEntries: live.agentEntries,
    recordItems: [],
  };
  const line = `${JSON.stringify(payload, null, 0)}\n`;
  ensureDirSync();
  try {
    if (fs.existsSync(DEV_QUEUE_LIVE_FILE) && fs.readFileSync(DEV_QUEUE_LIVE_FILE, "utf8") === line) {
      memoryLive = payload;
      return payload;
    }
  } catch {
    /* write */
  }
  fs.writeFileSync(DEV_QUEUE_LIVE_FILE, line, "utf8");
  memoryLive = payload;
  return payload;
}

/** @param {Array<Record<string, unknown>>} entries */
function sortLiveEntries(entries) {
  const running = [];
  const waiting = [];
  for (const e of entries) {
    if (e.status === "running") running.push(e);
    else waiting.push(e);
  }
  waiting.sort(
    (a, b) =>
      (typeof a.enqueuedAtMs === "number" ? a.enqueuedAtMs : 0) -
      (typeof b.enqueuedAtMs === "number" ? b.enqueuedAtMs : 0),
  );
  return [...running, ...waiting];
}

/**
 * @param {{
 *   id: string;
 *   requestIp: string;
 *   instructionPreview: string;
 *   instructionTooltip: string;
 *   instructionBody: string;
 *   enqueuedAtMs: number;
 *   source?: "web" | "ide";
 * }} meta
 * @param {"waiting" | "running"} status
 */
export function metaToPersistEntry(meta, status) {
  return {
    id: meta.id,
    requestIp: meta.requestIp,
    source: meta.source === "ide" ? "ide" : "web",
    instructionPreview: meta.instructionPreview,
    instructionTooltip: meta.instructionTooltip,
    instructionBody: meta.instructionBody,
    enqueuedAtMs: meta.enqueuedAtMs,
    status,
  };
}

function syncAgentHistoryFromPersistEntry(entry) {
  const st = String(entry.status ?? "");
  if (st === "running" || st === "waiting") {
    upsertOpsAgentHistoryFromQueueSync(entry);
  }
}

/** @param {Record<string, unknown>} entry */
export function persistDevQueueUpsert(entry) {
  const id = String(entry.id ?? "").trim();
  if (!id) return;
  const live = readLiveRawSync();
  const idx = live.agentEntries.findIndex((e) => String(e.id ?? "") === id);
  const next = { ...entry, id };
  if (idx >= 0) live.agentEntries[idx] = { ...live.agentEntries[idx], ...next };
  else live.agentEntries.push(next);
  live.agentEntries = sortLiveEntries(live.agentEntries);
  writeLiveRawSync(live);
  syncAgentHistoryFromPersistEntry(next);
}

/** @param {string} id */
export function persistDevQueueSetRunning(id) {
  const slotId = String(id ?? "").trim();
  if (!slotId) return;
  const live = readLiveRawSync();
  let found = false;
  for (const e of live.agentEntries) {
    if (String(e.id ?? "") === slotId) {
      e.status = "running";
      found = true;
    } else if (e.status === "running") {
      e.status = "waiting";
    }
  }
  if (!found) return;
  live.agentEntries = sortLiveEntries(live.agentEntries);
  writeLiveRawSync(live);
  const hit = live.agentEntries.find((e) => String(e.id ?? "") === slotId);
  if (hit) syncAgentHistoryFromPersistEntry(hit);
}

/** 완료·정리 시 — agentEntries를 비운 스냅샷만 남김 */
export function persistDevQueueClear() {
  writeLiveRawSync({ updatedAtMs: Date.now(), agentEntries: [] });
}

/** @param {string} id */
export function persistDevQueueRemove(id) {
  const slotId = String(id ?? "").trim();
  if (!slotId) return;
  const live = readLiveRawSync();
  const next = live.agentEntries.filter((e) => String(e.id ?? "") !== slotId);
  if (next.length === live.agentEntries.length) return;
  if (next.length === 0) {
    persistDevQueueClear();
    return;
  }
  live.agentEntries = next;
  writeLiveRawSync(live);
}

/**
 * 디스크 스냅샷 + 메모리 실행 큐 병합(표시용 — 디스크는 덮어쓰지 않음)
 * @param {Array<Record<string, unknown>>} disk
 * @param {Array<Record<string, unknown>>} runtime
 */
export function unionAgentEntriesForDisplay(disk, runtime) {
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  for (const e of disk) {
    const id = String(e.id ?? "").trim();
    if (!id) continue;
    byId.set(id, e);
  }
  for (const e of runtime) {
    if (String(e.requestIp ?? "").trim() === RECORD_MODE_REQUEST_IP) continue;
    const id = String(e.id ?? "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, ...e } : e);
  }
  return sortLiveEntries([...byId.values()]);
}

/**
 * 오래된 running만 제거·파일 비움(dev 재시작 시 전체 삭제하지 않음)
 * @param {number} [maxRunningAgeMs]
 */
export function sweepStalePersistedDevQueueSync(maxRunningAgeMs = 45 * 60 * 1000) {
  const live = readLiveRawSync();
  const now = Date.now();
  const next = live.agentEntries.filter((e) => {
    if (e.status !== "running") return true;
    const at = typeof e.enqueuedAtMs === "number" ? e.enqueuedAtMs : 0;
    return at <= 0 || now - at < maxRunningAgeMs;
  });
  if (next.length === live.agentEntries.length) return;
  if (next.length === 0) persistDevQueueClear();
  else {
    live.agentEntries = sortLiveEntries(next);
    writeLiveRawSync(live);
  }
}

/** UI·GET — 디스크 영속 큐 + lease 보조 + 순번 */
/**
 * @param {Array<Record<string, unknown>>} [runtimeEntries]
 */
export function readDevQueueDisplaySnapshotSync(runtimeEntries = []) {
  const live = loadLiveFromDiskSync();
  memoryLive = live;
  const filtered = live.agentEntries.filter(
    (e) => String(e.requestIp ?? "").trim() !== RECORD_MODE_REQUEST_IP,
  );
  const unioned = unionAgentEntriesForDisplay(filtered, runtimeEntries);
  const merged = mergeIdeLeaseIntoDisplayEntries(unioned);
  const agentEntries = enrichAgentEntriesWithUnifiedSeq(merged);
  return {
    updatedAtMs: live.updatedAtMs,
    agentEntries,
    recordItems: [],
  };
}

/** @deprecated 메모리→전체 덮어쓰기 제거(재시작 시 큐 유실 방지) */
export function syncDevQueueDisplayFromRuntimeSync() {
  return readDevQueueDisplaySnapshotSync();
}

export function refreshDevQueueDisplaySnapshotSync() {
  return readDevQueueDisplaySnapshotSync();
}

/** @deprecated 증분 persist 사용 */
export function scheduleDevQueueDisplayRefresh() {}

export function buildDevQueueDisplayPayload() {
  return readDevQueueDisplaySnapshotSync();
}

/** 영속 큐 항목(메모리 비어도 dev 재시작 후 매칭용) */
export function readDevQueueLiveAgentEntriesSync() {
  return readLiveRawSync().agentEntries;
}

/** 서버 기동·복구 — 영속 큐의 대기·실행 중 항목을 이력 파일에 맞춤 */
export function reconcilePersistQueueToAgentHistorySync() {
  for (const e of readLiveRawSync().agentEntries) {
    const st = String(e.status ?? "");
    if (st === "running" || st === "waiting") {
      upsertOpsAgentHistoryFromQueueSync(e);
    }
  }
}
