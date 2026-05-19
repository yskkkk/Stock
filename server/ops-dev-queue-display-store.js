/**
 * 개발 대기열 **표시 SSOT** — server/.data/ops-dev-queue-display.json
 *
 * - UI·GET API는 이 파일(또는 프로세스 내 동일 스냅샷 캐시)만 읽는다.
 * - 실행 큐·IDE lease 변경 시 syncDevQueueDisplayFromRuntimeSync 로만 갱신.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichUnifiedQueueAgentAndRecord } from "./ops-unified-queue-seq.js";

const RECORD_MODE_REQUEST_IP = "record-mode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const DISPLAY_FILE = path.join(DATA_DIR, "ops-dev-queue-display.json");

/** @type {ReturnType<typeof setImmediate> | null} */
let refreshScheduled = null;

/** @type {{ updatedAtMs: number; agentEntries: unknown[]; recordItems: unknown[] } | null} */
let memorySnapshot = null;

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** @param {{ agentEntries: unknown[]; recordItems: unknown[] }} payload */
function contentKey(payload) {
  return JSON.stringify({
    agentEntries: payload.agentEntries,
    recordItems: payload.recordItems,
  });
}

/**
 * @returns {{
 *   agentEntries: Array<Record<string, unknown>>;
 *   recordItems: Array<Record<string, unknown>>;
 * }}
 */
export function buildDevQueueDisplayPayload() {
  const { agentEntries } = enrichUnifiedQueueAgentAndRecord([]);
  const agentOnly = agentEntries.filter(
    (e) => String(e.requestIp ?? "").trim() !== RECORD_MODE_REQUEST_IP,
  );
  return {
    agentEntries: agentOnly,
    recordItems: [],
  };
}

/** @param {unknown} parsed */
function normalizeSnapshot(parsed) {
  if (!isPlainObject(parsed)) {
    return { updatedAtMs: 0, agentEntries: [], recordItems: [] };
  }
  const updatedAtMs =
    typeof parsed.updatedAtMs === "number" && Number.isFinite(parsed.updatedAtMs)
      ? parsed.updatedAtMs
      : 0;
  const agentEntries = Array.isArray(parsed.agentEntries) ? parsed.agentEntries : [];
  const recordItems = Array.isArray(parsed.recordItems) ? parsed.recordItems : [];
  return { updatedAtMs, agentEntries, recordItems };
}

function loadDisplayFromDiskSync() {
  try {
    if (!fs.existsSync(DISPLAY_FILE)) {
      return { updatedAtMs: 0, agentEntries: [], recordItems: [] };
    }
    const raw = fs.readFileSync(DISPLAY_FILE, "utf8");
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return { updatedAtMs: 0, agentEntries: [], recordItems: [] };
  }
}

/** @returns {{ updatedAtMs: number; agentEntries: unknown[]; recordItems: unknown[] }} */
export function readDevQueueDisplaySnapshotSync() {
  if (memorySnapshot) return memorySnapshot;
  memorySnapshot = loadDisplayFromDiskSync();
  return memorySnapshot;
}

/** 실행 큐·lease 등 런타임 상태 → 표시 스냅샷 디스크 기록(쓰기 전용). */
export function syncDevQueueDisplayFromRuntimeSync() {
  const built = buildDevQueueDisplayPayload();
  const key = contentKey(built);
  const prevKey = memorySnapshot ? contentKey(memorySnapshot) : null;
  if (prevKey === key && memorySnapshot) {
    return memorySnapshot;
  }

  const payload = {
    updatedAtMs: Date.now(),
    agentEntries: built.agentEntries,
    recordItems: built.recordItems,
  };
  const line = `${JSON.stringify(payload, null, 0)}\n`;

  try {
    if (fs.existsSync(DISPLAY_FILE) && fs.readFileSync(DISPLAY_FILE, "utf8") === line) {
      memorySnapshot = payload;
      return payload;
    }
  } catch {
    /* fall through to write */
  }

  ensureDirSync();
  fs.writeFileSync(DISPLAY_FILE, line, "utf8");
  memorySnapshot = payload;
  return payload;
}

/** @deprecated 이름 호환 */
export function refreshDevQueueDisplaySnapshotSync() {
  return syncDevQueueDisplayFromRuntimeSync();
}

/** 큐 변경이 연속될 때 디스크 쓰기를 한 틱으로 묶는다. */
export function scheduleDevQueueDisplayRefresh() {
  if (refreshScheduled != null) return;
  refreshScheduled = setImmediate(() => {
    refreshScheduled = null;
    try {
      syncDevQueueDisplayFromRuntimeSync();
    } catch {
      /* ignore */
    }
  });
}
