/**
 * 개발 대기열 **표시 SSOT** — server/.data/ops-dev-queue-display.json
 *
 * - UI·GET API는 이 파일만 읽는다(메모리 큐 직접 조회 없음).
 * - 실행 큐(ops-agent-job-queue)·IDE lease·기록 모드 변경 시
 *   `syncDevQueueDisplayFromRuntimeSync` / `scheduleDevQueueDisplayRefresh` 로만 갱신.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";
import { enrichUnifiedQueueAgentAndRecord } from "./ops-unified-queue-seq.js";

const RECORD_MODE_REQUEST_IP = "record-mode";

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
  const { agentEntries } = enrichUnifiedQueueAgentAndRecord([]);
  const agentOnly = agentEntries.filter(
    (e) => String(e.requestIp ?? "").trim() !== RECORD_MODE_REQUEST_IP,
  );
  return {
    updatedAtMs: Date.now(),
    agentEntries: agentOnly,
    recordItems: [],
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

/** 실행 큐·lease 등 런타임 상태 → 표시 스냅샷 디스크 기록(쓰기 전용). */
export function syncDevQueueDisplayFromRuntimeSync() {
  const payload = buildDevQueueDisplayPayload();
  ensureDirSync();
  fs.writeFileSync(DISPLAY_FILE, `${JSON.stringify(payload, null, 0)}\n`, "utf8");
  return payload;
}

/** @deprecated 이름 호환 — syncDevQueueDisplayFromRuntimeSync 와 동일 */
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
