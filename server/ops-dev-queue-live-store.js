/**
 * 개발 대기열 **표시 미러** — server/.data/ops-dev-queue-display.json
 * SSOT는 메모리 FIFO(ops-agent-job-queue). 이 파일은 display-sync 폴러가 주기적으로 덮어씀.
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

/** @deprecated display-sync 미러 사용 — 호환용 no-op */
export function persistDevQueueUpsert(_entry) {}

/** @deprecated display-sync 미러 사용 — 호환용 no-op */
export function persistDevQueueSetRunning(_id) {}

/** 완료·정리 시 — agentEntries를 비운 스냅샷만 남김 */
export function persistDevQueueClear() {
  writeLiveRawSync({ updatedAtMs: Date.now(), agentEntries: [] });
}

/** @deprecated display-sync 미러 사용 — 호환용 no-op */
export function persistDevQueueRemove(_id) {}

/** @param {unknown} e */
function normalizeMirrorEntry(e) {
  if (!isPlainObject(e)) return null;
  const id = String(e.id ?? "").trim();
  if (!id) return null;
  const st = String(e.status ?? "waiting");
  const status = st === "running" ? "running" : "waiting";
  const out = {
    id,
    requestIp: String(e.requestIp ?? "").trim() || "—",
    source: e.source === "ide" ? "ide" : "web",
    instructionPreview: String(e.instructionPreview ?? "").trim() || "—",
    instructionTooltip: String(e.instructionTooltip ?? e.instructionPreview ?? "").trim() || "—",
    instructionBody: String(e.instructionBody ?? e.instructionPreview ?? "").slice(0, 16_000),
    enqueuedAtMs:
      typeof e.enqueuedAtMs === "number" && Number.isFinite(e.enqueuedAtMs)
        ? e.enqueuedAtMs
        : Date.now(),
    status,
  };
  const sessionId = String(e.sessionId ?? "").trim();
  if (sessionId) out.sessionId = sessionId;
  return out;
}

/**
 * display JSON 미러 — 인자는 sync가 만든 최종 행(메모리 ± 짧은 pending lease).
 * @param {Array<Record<string, unknown>>} runtimeEntries
 */
export function writeDevQueueDisplayMirrorFromRuntime(runtimeEntries) {
  const toWrite = sortLiveEntries(
    (Array.isArray(runtimeEntries) ? runtimeEntries : [])
      .map(normalizeMirrorEntry)
      .filter(Boolean)
      .filter((e) => String(e.requestIp ?? "").trim() !== RECORD_MODE_REQUEST_IP),
  );

  writeLiveRawSync({ updatedAtMs: Date.now(), agentEntries: toWrite });
  for (const row of toWrite) syncAgentHistoryFromPersistEntry(row);
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

/** UI·GET — 파일 미러 + enqueue 직전 lease(폴링·파일 읽기용, sync는 display-sync가 담당) */
export function readDevQueueDisplaySnapshotSync() {
  const live = loadLiveFromDiskSync();
  memoryLive = live;
  const filtered = live.agentEntries.filter(
    (e) => String(e.requestIp ?? "").trim() !== RECORD_MODE_REQUEST_IP,
  );
  const merged = mergeIdeLeaseIntoDisplayEntries(filtered);
  const agentEntries = enrichAgentEntriesWithUnifiedSeq(merged);
  return {
    updatedAtMs: live.updatedAtMs,
    agentEntries,
    recordItems: [],
  };
}

export function refreshDevQueueDisplaySnapshotSync() {
  return readDevQueueDisplaySnapshotSync();
}

/** @deprecated — ops-dev-queue-display-sync.js 사용 */
export function scheduleDevQueueDisplayRefresh() {
  void import("./ops-dev-queue-display-sync.js")
    .then((m) => m.requestDevQueueDisplaySyncNow())
    .catch(() => {});
}

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
