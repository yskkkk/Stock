/**
 * 운영 탭 Cursor 에이전트 실행 이력 — 서버 재시작 후에도 유지 (server/.data)
 * 실행 중(running) 레코드를 주기적으로 갱신해 UI 폴링으로 실시간 상태 표시 가능.
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
const OPS_AGENT_REQUEST_IP_MAX = 120;

const TRUNC_SUFFIX = "\n\n…(이하 저장 생략)";

/** @param {unknown} ip */
function sanitizeRequestIpForStore(ip) {
  return String(ip ?? "")
    .trim()
    .replace(/[\r\n\u0000]/g, "")
    .slice(0, OPS_AGENT_REQUEST_IP_MAX);
}

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
  if (typeof o.id !== "string" || typeof o.instruction !== "string") {
    return null;
  }

  const errRaw = o.error;
  const error =
    typeof errRaw === "string" && errRaw.trim().length > 0 ? errRaw.trim() : null;

  const finishedRaw = o.finishedAtMs;
  const finishedAtMs =
    typeof finishedRaw === "number" && Number.isFinite(finishedRaw)
      ? finishedRaw
      : null;

  const startedRaw = o.startedAtMs;
  const startedAtMs =
    typeof startedRaw === "number" && Number.isFinite(startedRaw)
      ? startedRaw
      : finishedAtMs ?? Date.now();

  const updatedRaw = o.updatedAtMs;
  const updatedAtMs =
    typeof updatedRaw === "number" && Number.isFinite(updatedRaw)
      ? updatedRaw
      : startedAtMs;

  const st = o.state;
  let state =
    st === "running" || st === "ok" || st === "error" || st === "cancelled"
      ? st
      : null;
  if (!state) {
    if (finishedAtMs == null) state = "running";
    else state = error ? "error" : "ok";
  }
  if (state === "running" && finishedAtMs != null) {
    state = error ? "error" : "ok";
  }

  return {
    id: o.id,
    state,
    startedAtMs,
    updatedAtMs,
    finishedAtMs,
    instruction: o.instruction,
    error,
    phaseLine: typeof o.phaseLine === "string" ? o.phaseLine : "",
    cursorLine: typeof o.cursorLine === "string" ? o.cursorLine : "",
    thinkingLine: typeof o.thinkingLine === "string" ? o.thinkingLine : "",
    toolLine: typeof o.toolLine === "string" ? o.toolLine : "",
    streamText: typeof o.streamText === "string" ? o.streamText : "",
    statusText:
      o.statusText === null || typeof o.statusText === "string"
        ? o.statusText
        : null,
    resultText:
      o.resultText === null || typeof o.resultText === "string"
        ? o.resultText
        : null,
    durationMs:
      typeof o.durationMs === "number" && Number.isFinite(o.durationMs)
        ? o.durationMs
        : null,
    runtimeLabel:
      o.runtimeLabel === null || typeof o.runtimeLabel === "string"
        ? o.runtimeLabel
        : null,
    requestIp: sanitizeRequestIpForStore(
      typeof o.requestIp === "string" ? o.requestIp : "",
    ),
  };
}

/** @returns {object[]} */
function readRawListSync() {
  try {
    if (!fsSync.existsSync(HISTORY_FILE)) return [];
    const raw = fsSync.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlainObject);
  } catch {
    return [];
  }
}

function saveRawListSync(list) {
  ensureDirSync();
  fsSync.writeFileSync(HISTORY_FILE, JSON.stringify(list), "utf8");
}

/** @returns {object[]} */
export function readOpsAgentHistorySync() {
  const raw = readRawListSync();
  const rows = raw
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);
  rows.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  return rows.slice(0, OPS_AGENT_HISTORY_MAX);
}

let writeChain = /** @type {Promise<unknown>} */ (Promise.resolve());

/** 실행 중인 이력을 사용자가 삭제한 경우 finalize가 동일 id로 레코드를 다시 만들지 않도록 함 */
const finalizeSkippedIds = /** @type {Set<string>} */ (new Set());

/**
 * @param {() => Promise<void>} fn
 */
function chainWrite(fn) {
  const p = writeChain.then(fn);
  writeChain = p.catch(() => {});
  return p;
}

/**
 * @param {string} id
 * @param {string} instruction
 * @param {string} [requestIp]
 * @returns {Promise<void>}
 */
export function prependRunningOpsEntry(id, instruction, requestIp = "") {
  return chainWrite(async () => {
    ensureDirSync();
    const ins = trimStoredTextForOpsHistory(
      instruction,
      OPS_AGENT_INSTRUCTION_STORE_MAX,
    );
    const rip = sanitizeRequestIpForStore(requestIp);
    const now = Date.now();
    const entry = {
      id,
      instruction: ins,
      state: "running",
      startedAtMs: now,
      updatedAtMs: now,
      finishedAtMs: null,
      error: null,
      phaseLine: "",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: null,
      runtimeLabel: null,
      requestIp: rip,
    };
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean)
      .filter((e) => e.id !== id);
    const next = [entry, ...prev].slice(0, OPS_AGENT_HISTORY_MAX);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next), "utf8");
  });
}

/**
 * @param {string} id
 * @param {{
 *   phaseLine?: string;
 *   cursorLine?: string;
 *   thinkingLine?: string;
 *   toolLine?: string;
 *   streamText?: string;
 *   statusText?: string | null;
 *   resultText?: string | null;
 *   durationMs?: number | null;
 *   runtimeLabel?: string | null;
 *   error?: string | null;
 * }} patch
 * @returns {Promise<void>}
 */
export function patchOpsAgentEntry(id, patch) {
  return chainWrite(async () => {
    ensureDirSync();
    const raw = readRawListSync();
    const list = raw
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    const i = list.findIndex((e) => e.id === id);
    if (i === -1) return;

    const cur = list[i];
    const streamPatch =
      patch.streamText !== undefined
        ? trimStoredTextForOpsHistory(patch.streamText, OPS_AGENT_FIELD_MAX_CHARS)
        : undefined;

    const nextRow = {
      ...cur,
      ...patch,
      ...(streamPatch !== undefined ? { streamText: streamPatch } : {}),
      updatedAtMs: Date.now(),
      state: "running",
      finishedAtMs: null,
    };
    list[i] = nextRow;
    await fs.writeFile(HISTORY_FILE, JSON.stringify(list), "utf8");
  });
}

/**
 * @param {string} id
 * @param {{
 *   state: "ok" | "error" | "cancelled";
 *   instruction?: string;
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
 *   requestIp?: string;
 * }} fin
 * @returns {Promise<void>}
 */
export function finalizeOpsAgentEntry(id, fin) {
  return chainWrite(async () => {
    if (finalizeSkippedIds.has(id)) {
      finalizeSkippedIds.delete(id);
      return;
    }
    ensureDirSync();
    const raw = readRawListSync();
    const list = raw
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    const i = list.findIndex((e) => e.id === id);
    const now = Date.now();
    const streamText = trimStoredTextForOpsHistory(
      fin.streamText,
      OPS_AGENT_FIELD_MAX_CHARS,
    );
    const resultText =
      fin.resultText != null
        ? trimStoredTextForOpsHistory(fin.resultText, OPS_AGENT_FIELD_MAX_CHARS)
        : null;
    const instruction =
      fin.instruction != null
        ? trimStoredTextForOpsHistory(fin.instruction, OPS_AGENT_INSTRUCTION_STORE_MAX)
        : undefined;

    const requestIpStored =
      fin.requestIp != null
        ? sanitizeRequestIpForStore(fin.requestIp)
        : sanitizeRequestIpForStore(list[i]?.requestIp ?? "");

    const row = {
      id,
      instruction: instruction ?? (list[i]?.instruction ?? ""),
      state: fin.state,
      startedAtMs: list[i]?.startedAtMs ?? now,
      updatedAtMs: now,
      finishedAtMs: now,
      error: fin.error,
      phaseLine: fin.phaseLine,
      cursorLine: fin.cursorLine,
      thinkingLine: fin.thinkingLine,
      toolLine: fin.toolLine,
      streamText,
      statusText: fin.statusText,
      resultText,
      durationMs: fin.durationMs,
      runtimeLabel: fin.runtimeLabel,
      requestIp: requestIpStored,
    };

    if (i === -1) {
      const next = [row, ...list].slice(0, OPS_AGENT_HISTORY_MAX);
      await fs.writeFile(HISTORY_FILE, JSON.stringify(next), "utf8");
      return;
    }
    list[i] = { ...list[i], ...row };
    await fs.writeFile(HISTORY_FILE, JSON.stringify(list), "utf8");
  });
}

/**
 * @param {object} entry
 * @returns {Promise<void>}
 */
export function appendOpsAgentHistoryEntry(entry) {
  return chainWrite(async () => {
    ensureDirSync();
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean)
      .filter((e) => e.id !== entry.id);
    const next = [entry, ...prev].slice(0, OPS_AGENT_HISTORY_MAX);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next), "utf8");
  });
}

/** @returns {Promise<void>} */
export function clearOpsAgentHistoryAsync() {
  return chainWrite(async () => {
    ensureDirSync();
    await fs.writeFile(HISTORY_FILE, JSON.stringify([]), "utf8");
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export function removeOpsAgentHistoryEntryById(id) {
  return chainWrite(async () => {
    ensureDirSync();
    const raw = readRawListSync();
    const list = raw
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    const victim = list.find((e) => e.id === id);
    if (victim?.state === "running") {
      finalizeSkippedIds.add(id);
    }
    const next = list.filter((e) => e.id !== id);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(next), "utf8");
  });
}

/**
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
 *   requestIp?: string;
 * }} cap
 */
export function buildHistoryEntryFromCapture(cap) {
  const instruction = trimStoredTextForOpsHistory(
    cap.instruction,
    OPS_AGENT_INSTRUCTION_STORE_MAX,
  );
  const err =
    cap.error && String(cap.error).trim() ? String(cap.error).trim() : null;
  const now = Date.now();
  return {
    id: randomUUID(),
    instruction,
    state: err ? "error" : "ok",
    startedAtMs: now,
    updatedAtMs: now,
    finishedAtMs: now,
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
    requestIp: sanitizeRequestIpForStore(cap.requestIp ?? ""),
  };
}
