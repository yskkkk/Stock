/**
 * 개발 대기열 UI용 스냅샷 — server/.data/ops-dev-queue-display.json
 * 에이전트·기록 모드·IDE lease 변경 시 갱신. 리다이렉트·새로고침 후에도 동일 목록 복원.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";
import { readRecordModeQueueSync } from "./ops-record-mode-store.js";
import { enrichUnifiedQueueAgentAndRecord } from "./ops-unified-queue-seq.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const DISPLAY_FILE = path.join(DATA_DIR, "ops-dev-queue-display.json");

/** @type {ReturnType<typeof setImmediate> | null} */
let refreshScheduled = null;

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * @returns {{
 *   updatedAtMs: number;
 *   agentEntries: Array<Record<string, unknown>>;
 *   recordItems: Array<Record<string, unknown>>;
 * }}
 */
export function buildDevQueueDisplayPayload() {
  const disk = readRecordModeQueueSync();
  const { agentEntries, recordItems } = enrichUnifiedQueueAgentAndRecord(disk.items);
  const recordVisible = recordItems.filter(
    (it) => String(it.status ?? "") !== "error",
  );
  return {
    updatedAtMs: Date.now(),
    agentEntries,
    recordItems: recordVisible,
  };
}

/** @returns {{ updatedAtMs: number; agentEntries: unknown[]; recordItems: unknown[] }} */
export function readDevQueueDisplaySnapshotSync() {
  try {
    if (!fs.existsSync(DISPLAY_FILE)) {
      return { updatedAtMs: 0, agentEntries: [], recordItems: [] };
    }
    const raw = fs.readFileSync(DISPLAY_FILE, "utf8");
    const parsed = JSON.parse(raw);
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
  } catch {
    return { updatedAtMs: 0, agentEntries: [], recordItems: [] };
  }
}

export function refreshDevQueueDisplaySnapshotSync() {
  const payload = buildDevQueueDisplayPayload();
  ensureDirSync();
  fs.writeFileSync(DISPLAY_FILE, `${JSON.stringify(payload, null, 0)}\n`, "utf8");
  return payload;
}

/** 큐 변경이 연속될 때 디스크 쓰기를 한 틱으로 묶는다. */
export function scheduleDevQueueDisplayRefresh() {
  if (refreshScheduled != null) return;
  refreshScheduled = setImmediate(() => {
    refreshScheduled = null;
    try {
      refreshDevQueueDisplaySnapshotSync();
    } catch {
      /* ignore */
    }
  });
}
