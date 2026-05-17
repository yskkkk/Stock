/**
 * 운영 탭 Cursor 에이전트 실행 이력 — 서버 재시작 후에도 유지 (server/.data)
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, ".data");
const HISTORY_FILE = path.join(DATA_DIR, "ops-cursor-agent-history.json");
export const OPS_AGENT_HISTORY_MAX = 40;
const OPS_AGENT_FIELD_MAX_CHARS = 120_000;
const OPS_AGENT_INSTRUCTION_STORE_MAX = 16_000;

const TRUNC_SUFFIX = "\n\n…(이하 저장 생략)";

/** @param {string} s @param {number} maxChars */
export function trimStoredTextForOpsHistory(s, maxChars) {
  const t = String(s ?? "");
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}${TRUNC_SUFFIX}`;
}

function ensureDirSync() {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** @param {Record<string, unknown>} o */
function parseHistoryRecord(o) {
  if (
    typeof o.id !== "string" ||
    typeof o.instruction !== "string" ||
    typeof o.finishedAtMs !== "number" ||
    !Number.isFinite(o.finishedAtMs)
  ) {
    return null;
  }

  const errRaw = o.error;
  const error =
    typeof errRaw === "string" && errRaw.trim().length > 0 ? errRaw.trim() : null;

  const clientIp =
    typeof o.clientIp === "string" && o.clientIp.trim().length > 0
      ? o.clientIp.trim()
      : "";

  return {
    id: o.id,
    finishedAtMs: o.finishedAtMs,
    instruction: o.instruction,
    clientIp,
    error,
    phaseLine: typeof o.phaseLine === "string" ? o.phaseLine : "",
    cursorLine: typeof o.cursorLine === "string" ? o.cursorLine : "",
    thinkingLine: typeof o.thinkingLine === "string" ? o.thinkingLine : "",
    toolLine: typeof o.toolLine === "string" ? o.toolLine : "",
    streamText: typeof o.streamText === "string" ? o.streamText : "",
    statusText: typeof o.statusText === "string" ? o.statusText : null,
    resultText: typeof o.resultText === "string" ? o.resultText : null,
    durationMs:
      typeof o.durationMs === "number" && Number.isFinite(o.durationMs)
        ? o.durationMs
        : null,
    runtimeLabel: typeof o.runtimeLabel === "string" ? o.runtimeLabel : null,
  };
}

/** @returns {object[]} */
export function readOpsAgentHistorySync() {
  try {
    if (!fsSync.existsSync(HISTORY_FILE)) return [];
    const raw = fsSync.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isPlainObject)
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean)
      .slice(0, OPS_AGENT_HISTORY_MAX);
  } catch {
    return [];
  }
}

let writeChain = Promise.resolve();

/**
 * @param {object} entry
 * @returns {Promise<void>}
 */
export function appendOpsAgentHistoryEntry(entry) {
  const run = async () => {
    ensureDirSync();
    let prev = [];
    try {
      const raw = await fs.readFile(HISTORY_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        prev = parsed
          .filter(isPlainObject)
          .map((o) =>
            parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)),
          )
          .filter(Boolean);
      }
    } catch {
      /* missing or corrupt */
    }
    const next = [entry, ...prev].slice(0, OPS_AGENT_HISTORY_MAX);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next), "utf8");
  };

  const p = writeChain.then(run);
  writeChain = p.catch(() => {});
  return p;
}

/** @returns {Promise<void>} */
export function clearOpsAgentHistoryAsync() {
  const run = async () => {
    ensureDirSync();
    await fs.writeFile(HISTORY_FILE, JSON.stringify([]), "utf8");
  };
  const p = writeChain.then(run);
  writeChain = p.catch(() => {});
  return p;
}

/**
 * SSE 캡처로부터 저장 레코드 생성 (클라이언트 OpsAgentHistoryEntry 와 동일 스키마)
 * @param {{
 *   instruction: string;
 *   phaseLine: string;
 *   cursorLine: string;
 *   thinkingLine: string;
 *   toolLine: string;
 *   streamText: string;
 *   statusText: string | null;
 *   resultText: string | null;
 *   durationMs: number | null;
 *   runtimeLabel: string | null;
 *   error: string | null;
 *   clientIp?: string;
 * }} cap
 */
export function buildHistoryEntryFromCapture(cap) {
  const instruction = trimStoredTextForOpsHistory(
    cap.instruction,
    OPS_AGENT_INSTRUCTION_STORE_MAX,
  );
  const err =
    cap.error && String(cap.error).trim() ? String(cap.error).trim() : null;
  const ip =
    typeof cap.clientIp === "string" && cap.clientIp.trim().length > 0
      ? cap.clientIp.trim()
      : "";

  return {
    id: randomUUID(),
    finishedAtMs: Date.now(),
    instruction,
    clientIp: ip,
    error: err,
    phaseLine: cap.phaseLine ?? "",
    cursorLine: cap.cursorLine ?? "",
    thinkingLine: cap.thinkingLine ?? "",
    toolLine: cap.toolLine ?? "",
    streamText: trimStoredTextForOpsHistory(cap.streamText, OPS_AGENT_FIELD_MAX_CHARS),
    statusText: cap.statusText,
    resultText:
      cap.resultText != null
        ? trimStoredTextForOpsHistory(cap.resultText, OPS_AGENT_FIELD_MAX_CHARS)
        : null,
    durationMs: cap.durationMs,
    runtimeLabel: cap.runtimeLabel,
  };
}
