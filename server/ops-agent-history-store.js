/**
 * 운영 탭 Cursor 에이전트 실행 이력 — 서버 재시작 후에도 유지 (server/.data)
 * 실행 중(running) 레코드를 주기적으로 갱신해 UI 폴링으로 실시간 상태 표시 가능.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { opsIdePromptFingerprint, opsIdePromptsMatch } from "./ops-ide-prompt-match.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, ".data");
const HISTORY_FILE = path.join(DATA_DIR, "ops-cursor-agent-history.json");
export const OPS_AGENT_HISTORY_MAX = (() => {
  const n = Number(process.env.OPS_AGENT_HISTORY_MAX ?? 500);
  return Number.isFinite(n) && n >= 20 ? Math.min(5000, Math.floor(n)) : 500;
})();
const OPS_AGENT_FIELD_MAX_CHARS = 120_000;
/** read_file / write 등 도구 호출 누적 로그 상한 */
const OPS_AGENT_TOOL_LOG_MAX_CHARS = 96_000;
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
    st === "running" ||
    st === "waiting" ||
    st === "ok" ||
    st === "error" ||
    st === "cancelled" ||
    st === "rejected"
      ? st
      : null;
  if (!state) {
    if (finishedAtMs == null) state = "running";
    else state = error ? "error" : "ok";
  }
  if (
    (state === "running" || state === "waiting") &&
    finishedAtMs != null
  ) {
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
    toolLog:
      typeof o.toolLog === "string"
        ? trimStoredTextForOpsHistory(o.toolLog, OPS_AGENT_TOOL_LOG_MAX_CHARS)
        : "",
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
    workspaceAppliedAtMs:
      typeof o.workspaceAppliedAtMs === "number" && Number.isFinite(o.workspaceAppliedAtMs)
        ? o.workspaceAppliedAtMs
        : null,
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
  const tmp = `${HISTORY_FILE}.${process.pid}.${Date.now()}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(list), "utf8");
  try {
    fsSync.renameSync(tmp, HISTORY_FILE);
  } catch {
    try {
      fsSync.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    fsSync.writeFileSync(HISTORY_FILE, JSON.stringify(list), "utf8");
  }
}

async function writeHistoryListAsync(list) {
  ensureDirSync();
  const tmp = `${HISTORY_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list), "utf8");
  try {
    await fs.rename(tmp, HISTORY_FILE);
  } catch {
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    await fs.writeFile(HISTORY_FILE, JSON.stringify(list), "utf8");
  }
}

/**
 * 개발 큐 영속 행 → 이력 JSON 동기 기록(재시작 전 async 유실 방지).
 * @param {Record<string, unknown>} queueEntry
 */
/** @param {NonNullable<ReturnType<typeof parseHistoryRecord>>} a @param {NonNullable<ReturnType<typeof parseHistoryRecord>>} b */
function mergeIdeHistoryRowsPreferNewerActive(a, b) {
  const active = (r) => r.state === "running" || r.state === "waiting";
  const primary = active(a) ? a : active(b) ? b : a;
  const secondary = primary === a ? b : a;
  return {
    ...primary,
    id: primary.id,
    instruction: primary.instruction || secondary.instruction,
    startedAtMs: Math.min(
      primary.startedAtMs ?? Number.POSITIVE_INFINITY,
      secondary.startedAtMs ?? Number.POSITIVE_INFINITY,
    ),
    updatedAtMs: Math.max(primary.updatedAtMs ?? 0, secondary.updatedAtMs ?? 0),
    finishedAtMs: active(primary) ? null : (primary.finishedAtMs ?? secondary.finishedAtMs),
    phaseLine: primary.phaseLine || secondary.phaseLine,
    cursorLine: primary.cursorLine || secondary.cursorLine,
    thinkingLine: primary.thinkingLine || secondary.thinkingLine,
    toolLine: primary.toolLine || secondary.toolLine,
    toolLog: primary.toolLog || secondary.toolLog,
    streamText: primary.streamText || secondary.streamText,
    statusText: primary.statusText ?? secondary.statusText,
    resultText: primary.resultText ?? secondary.resultText,
    durationMs: primary.durationMs ?? secondary.durationMs,
    runtimeLabel: primary.runtimeLabel ?? secondary.runtimeLabel ?? "ide",
    workspaceAppliedAtMs:
      primary.workspaceAppliedAtMs ?? secondary.workspaceAppliedAtMs,
  };
}

/** @param {NonNullable<ReturnType<typeof parseHistoryRecord>>} a @param {NonNullable<ReturnType<typeof parseHistoryRecord>>} b */
function mergeIdeHistoryRowsAnyState(a, b) {
  const active = (r) => r.state === "running" || r.state === "waiting";
  if (active(a) || active(b)) return mergeIdeHistoryRowsPreferNewerActive(a, b);
  const primary = (a.updatedAtMs ?? 0) >= (b.updatedAtMs ?? 0) ? a : b;
  const secondary = primary === a ? b : a;
  return {
    ...primary,
    id: primary.id,
    instruction: primary.instruction || secondary.instruction,
    startedAtMs: Math.min(
      primary.startedAtMs ?? Number.POSITIVE_INFINITY,
      secondary.startedAtMs ?? Number.POSITIVE_INFINITY,
    ),
    updatedAtMs: Math.max(primary.updatedAtMs ?? 0, secondary.updatedAtMs ?? 0),
    finishedAtMs: Math.max(
      primary.finishedAtMs ?? 0,
      secondary.finishedAtMs ?? 0,
    ) || null,
    error: primary.error ?? secondary.error,
    phaseLine: primary.phaseLine || secondary.phaseLine,
    cursorLine: primary.cursorLine || secondary.cursorLine,
    thinkingLine: primary.thinkingLine || secondary.thinkingLine,
    toolLine: primary.toolLine || secondary.toolLine,
    toolLog: primary.toolLog || secondary.toolLog,
    streamText: primary.streamText || secondary.streamText,
    statusText: primary.statusText ?? secondary.statusText,
    resultText: primary.resultText ?? secondary.resultText,
    durationMs: primary.durationMs ?? secondary.durationMs,
    runtimeLabel: primary.runtimeLabel ?? secondary.runtimeLabel ?? "ide",
    workspaceAppliedAtMs:
      primary.workspaceAppliedAtMs ?? secondary.workspaceAppliedAtMs,
  };
}

/**
 * IDE 동일 지시문 중복 이력 행 정리(기동·조회 시).
 */
/**
 * 메모리 큐가 비었는데 이력만 running/waiting인 IDE 고아 — 재기동·서버 다운 후 UI 정리.
 */
export function finalizeOrphanIdeAgentHistoryOnBootSync() {
  const prev = readRawListSync()
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);
  if (!prev.length) return;

  const now = Date.now();
  let changed = false;
  const next = prev.map((e) => {
    if (sanitizeRequestIpForStore(e.requestIp) !== "cursor-ide") return e;
    if (e.state !== "running" && e.state !== "waiting") return e;
    changed = true;
    const started = e.startedAtMs ?? now;
    return {
      ...e,
      state: /** @type {const} */ ("cancelled"),
      updatedAtMs: now,
      finishedAtMs: now,
      error: null,
      statusText: "서버 재시작·연결 끊김",
      resultText:
        "개발 서버가 중단되었거나 IDE release가 호출되지 않아 실행 중 상태를 중단 처리했습니다.",
      durationMs: Math.max(0, now - started),
      runtimeLabel: e.runtimeLabel || "ide",
    };
  });
  if (!changed) return;
  next.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  saveRawListSync(next.slice(0, OPS_AGENT_HISTORY_MAX));
}

/**
 * display 큐에서 제거된 running 행에 대응하는 이력 id를 중단 처리.
 * @param {string[]} ids
 */
export function finalizeOrphanIdeAgentHistoryIdsSync(ids) {
  const want = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((x) => String(x ?? "").trim())
      .filter(Boolean),
  );
  if (want.size === 0) return;

  const prev = readRawListSync()
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);
  const now = Date.now();
  let changed = false;
  const next = prev.map((e) => {
    if (!want.has(e.id)) return e;
    if (e.state !== "running" && e.state !== "waiting") return e;
    changed = true;
    const started = e.startedAtMs ?? now;
    return {
      ...e,
      state: /** @type {const} */ ("cancelled"),
      updatedAtMs: now,
      finishedAtMs: now,
      error: null,
      statusText: "실행 큐 만료",
      resultText: "오래 실행 중으로 표시된 항목을 자동으로 중단 처리했습니다.",
      durationMs: Math.max(0, now - started),
      runtimeLabel: e.runtimeLabel || "ide",
    };
  });
  if (!changed) return;
  next.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  saveRawListSync(next.slice(0, OPS_AGENT_HISTORY_MAX));
}

export function collapseIdeAgentHistoryDuplicatesSync() {
  const prev = readRawListSync()
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);
  if (!prev.length) return;

  /** @type {Map<string, NonNullable<ReturnType<typeof parseHistoryRecord>>>} */
  const ideByFp = new Map();
  const rest = [];

  for (const e of prev) {
    if (sanitizeRequestIpForStore(e.requestIp) !== "cursor-ide") {
      rest.push(e);
      continue;
    }
    const fp = opsIdePromptFingerprint(e.instruction);
    if (!fp) {
      rest.push(e);
      continue;
    }
    const hit = ideByFp.get(fp);
    ideByFp.set(fp, hit ? mergeIdeHistoryRowsAnyState(hit, e) : e);
  }

  const merged = [...ideByFp.values(), ...rest];
  merged.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  saveRawListSync(merged.slice(0, OPS_AGENT_HISTORY_MAX));
}

/**
 * @param {string} prompt
 * @returns {string | null}
 */
/** IDE — 동일 지시문 이력 id 재사용(대기·실행·완료 포함) */
export function findActiveIdeHistoryIdForPromptSync(prompt) {
  const ins = trimStoredTextForOpsHistory(
    String(prompt ?? "").trim(),
    OPS_AGENT_INSTRUCTION_STORE_MAX,
  );
  if (!ins) return null;
  const prev = readRawListSync()
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);
  const dup = findRecentIdeHistoryDuplicateIndex(prev, ins, "cursor-ide");
  return dup >= 0 ? prev[dup].id : null;
}

/** @deprecated findActiveIdeHistoryIdForPromptSync 사용 */
export function findCanonicalIdeHistoryIdForPromptSync(prompt) {
  return findActiveIdeHistoryIdForPromptSync(prompt);
}

export function upsertOpsAgentHistoryFromQueueSync(queueEntry) {
  const proposedId = String(queueEntry.id ?? "").trim();
  if (!proposedId) return;

  const requestIp = sanitizeRequestIpForStore(queueEntry.requestIp ?? "");
  const ins = trimStoredTextForOpsHistory(
    String(queueEntry.instructionBody ?? "").trim() ||
      String(queueEntry.instructionPreview ?? "").trim(),
    OPS_AGENT_INSTRUCTION_STORE_MAX,
  );
  if (!ins) return;

  const stRaw = String(queueEntry.status ?? "waiting").toLowerCase();
  const state = stRaw === "running" ? "running" : "waiting";
  const enqueuedAtMs =
    typeof queueEntry.enqueuedAtMs === "number" && Number.isFinite(queueEntry.enqueuedAtMs)
      ? queueEntry.enqueuedAtMs
      : Date.now();

  const prev = readRawListSync()
    .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
    .filter(Boolean);

  let canonicalId = proposedId;
  let targetIdx = prev.findIndex((e) => e.id === proposedId);
  if (requestIp === "cursor-ide") {
    const dup = findRecentIdeHistoryDuplicateIndex(prev, ins, requestIp);
    if (dup >= 0) {
      canonicalId = prev[dup].id;
      targetIdx = dup;
    }
  }

  const prevRow = targetIdx >= 0 ? prev[targetIdx] : null;

  const now = Date.now();
  const wasRunning = prevRow?.state === "running";
  const startedAtMs =
    state === "running" && !wasRunning
      ? now
      : (prevRow?.startedAtMs ?? enqueuedAtMs);
  const row = {
    id: canonicalId,
    instruction: ins,
    state,
    startedAtMs,
    updatedAtMs: now,
    finishedAtMs: null,
    error: null,
    phaseLine: prevRow?.phaseLine ?? "",
    cursorLine: prevRow?.cursorLine ?? "",
    thinkingLine: prevRow?.thinkingLine ?? "",
    toolLine: prevRow?.toolLine ?? "",
    toolLog: prevRow?.toolLog ?? "",
    streamText: prevRow?.streamText ?? "",
    statusText: prevRow?.statusText ?? null,
    resultText: prevRow?.resultText ?? null,
    durationMs: null,
    runtimeLabel: prevRow?.runtimeLabel ?? (requestIp === "cursor-ide" ? "ide" : null),
    requestIp,
    workspaceAppliedAtMs: prevRow?.workspaceAppliedAtMs ?? null,
  };

  const withoutDupes = prev.filter(
    (e) => !isDropableIdeInstructionDuplicate(e, ins, canonicalId),
  );
  const next = [row, ...withoutDupes].slice(0, OPS_AGENT_HISTORY_MAX);
  saveRawListSync(next);
  collapseIdeAgentHistoryDuplicatesSync();
}

/** @returns {object[]} */
export function readOpsAgentHistorySync() {
  collapseIdeAgentHistoryDuplicatesSync();
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
/**
 * IDE 단일 큐 대기 — 웹 운영 탭·개발 대기열에 표시.
 * @param {string} id
 * @param {string} instruction
 * @param {string} [requestIp]
 */
export function prependWaitingOpsEntry(id, instruction, requestIp = "") {
  return chainWrite(async () => {
    ensureDirSync();
    const ins = trimStoredTextForOpsHistory(
      instruction,
      OPS_AGENT_INSTRUCTION_STORE_MAX,
    );
    const rip = sanitizeRequestIpForStore(requestIp);
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    let useId = id;
    const dup = findRecentIdeHistoryDuplicateIndex(prev, ins, rip);
    if (dup >= 0) useId = prev[dup].id;
    const now = Date.now();
    const entry = {
      id: useId,
      instruction: ins,
      state: "waiting",
      startedAtMs: now,
      updatedAtMs: now,
      finishedAtMs: null,
      error: null,
      phaseLine: "",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      toolLog: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: null,
      runtimeLabel: null,
      requestIp: rip,
      workspaceAppliedAtMs: null,
    };
    const withoutDupes = prev.filter(
      (e) => !isDropableIdeInstructionDuplicate(e, ins, useId),
    );
    const next = [entry, ...withoutDupes].slice(0, OPS_AGENT_HISTORY_MAX);
    await writeHistoryListAsync(next);
  });
}

export function prependRunningOpsEntry(id, instruction, requestIp = "") {
  return chainWrite(async () => {
    ensureDirSync();
    const ins = trimStoredTextForOpsHistory(
      instruction,
      OPS_AGENT_INSTRUCTION_STORE_MAX,
    );
    const rip = sanitizeRequestIpForStore(requestIp);
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    let useId = id;
    const dup = findRecentIdeHistoryDuplicateIndex(prev, ins, rip);
    if (dup >= 0) useId = prev[dup].id;
    const now = Date.now();
    const entry = {
      id: useId,
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
      toolLog: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: null,
      runtimeLabel: null,
      requestIp: rip,
      workspaceAppliedAtMs: null,
    };
    const withoutDupes = prev.filter(
      (e) => !isDropableIdeInstructionDuplicate(e, ins, useId),
    );
    const next = [entry, ...withoutDupes].slice(0, OPS_AGENT_HISTORY_MAX);
    await writeHistoryListAsync(next);
  });
}

const POLICY_REJECTED_INSTRUCTION_PLACEHOLDER =
  "(정책에 의해 요청 원문은 저장하지 않았습니다.)";

/**
 * 정책 거부 이력 — 에이전트 미실행.
 * @param {{ id: string; requestIp?: string; policyCode: string; userMessage: string }} p
 * @returns {Promise<void>}
 */
export function prependPolicyRejectedOpsEntry(p) {
  return chainWrite(async () => {
    ensureDirSync();
    const rip = sanitizeRequestIpForStore(p.requestIp ?? "");
    const now = Date.now();
    const errLine = `${String(p.userMessage ?? "").trim()} [${String(p.policyCode ?? "").trim()}]`;
    const entry = {
      id: p.id,
      instruction: POLICY_REJECTED_INSTRUCTION_PLACEHOLDER,
      state: "rejected",
      startedAtMs: now,
      updatedAtMs: now,
      finishedAtMs: now,
      error: errLine.slice(0, OPS_AGENT_FIELD_MAX_CHARS),
      phaseLine: "",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      toolLog: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: 0,
      runtimeLabel: null,
      requestIp: rip,
      workspaceAppliedAtMs: null,
    };
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean)
      .filter((e) => e.id !== p.id);
    const next = [entry, ...prev].slice(0, OPS_AGENT_HISTORY_MAX);
    await writeHistoryListAsync(next);
  });
}

/**
 * 큐 대기(`waiting`) 상태 레코드는 더 이상 만들지 않는다.
 * 과거 파일·레거시 행만 `waiting`일 수 있음 — 실행 시작 시 running으로 승격.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export function promoteOpsAgentEntryToRunning(id) {
  return chainWrite(async () => {
    ensureDirSync();
    const raw = readRawListSync();
    const list = raw
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    const i = list.findIndex((e) => e.id === id);
    if (i === -1) return false;
    const cur = list[i];
    if (cur.state !== "waiting" && cur.state !== "running") return false;
    const runStartedAt = Date.now();
    list[i] = {
      ...cur,
      state: "running",
      startedAtMs: cur.state === "running" ? cur.startedAtMs : runStartedAt,
      updatedAtMs: runStartedAt,
      finishedAtMs: null,
    };
    await writeHistoryListAsync(list);
    return true;
  });
}

/**
 * @param {string} id
 * @param {{
 *   phaseLine?: string;
 *   cursorLine?: string;
 *   thinkingLine?: string;
 *   toolLine?: string;
 *   toolLog?: string;
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
    const toolLogPatch =
      patch.toolLog !== undefined
        ? trimStoredTextForOpsHistory(patch.toolLog, OPS_AGENT_TOOL_LOG_MAX_CHARS)
        : undefined;

    const nextRow = {
      ...cur,
      ...patch,
      ...(streamPatch !== undefined ? { streamText: streamPatch } : {}),
      ...(toolLogPatch !== undefined ? { toolLog: toolLogPatch } : {}),
      updatedAtMs: Date.now(),
      state: "running",
      finishedAtMs: null,
    };
    list[i] = nextRow;
    await writeHistoryListAsync(list);
  });
}

/**
 * @param {string} id
 * @param {{
 *   state: "ok" | "error" | "cancelled" | "rejected";
 *   instruction?: string;
 *   phaseLine: string;
 *   cursorLine: string;
 *   thinkingLine: string;
 *   toolLine: string;
 *   toolLog: string;
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
/**
 * IDE 동일 지시문에 대한 중복 이력 행(실행 중·방금 완료) 찾기.
 * @param {NonNullable<ReturnType<typeof parseHistoryRecord>>[]} list
 * @param {string} instruction
 * @param {string} requestIp
 * @param {number} [maxAgeMs]
 */
/**
 * IDE 동일 지시문 — 실행 중·대기 중복만 제거(완료 이력은 유지).
 * @param {NonNullable<ReturnType<typeof parseHistoryRecord>>} e
 * @param {string} instruction
 * @param {string} [keepId]
 */
function isDropableIdeInstructionDuplicate(e, instruction, keepId = "") {
  if (sanitizeRequestIpForStore(e.requestIp) !== "cursor-ide") return false;
  if (keepId && e.id === keepId) return true;
  return opsIdePromptsMatch(e.instruction, instruction);
}

function findRecentIdeHistoryDuplicateIndex(list, instruction, requestIp) {
  const rip = sanitizeRequestIpForStore(requestIp);
  if (rip !== "cursor-ide") return -1;
  if (!opsIdePromptFingerprint(instruction)) return -1;
  let finishedIdx = -1;
  let finishedUpdated = -1;
  for (let j = 0; j < list.length; j++) {
    const e = list[j];
    if (sanitizeRequestIpForStore(e.requestIp) !== rip) continue;
    if (!opsIdePromptsMatch(e.instruction, instruction)) continue;
    if (e.state === "running" || e.state === "waiting") return j;
    const u = e.updatedAtMs ?? 0;
    if (u >= finishedUpdated) {
      finishedUpdated = u;
      finishedIdx = j;
    }
  }
  return finishedIdx;
}

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
    let i = list.findIndex((e) => e.id === id);
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
      toolLog: trimStoredTextForOpsHistory(
        fin.toolLog ?? list[i]?.toolLog ?? "",
        OPS_AGENT_TOOL_LOG_MAX_CHARS,
      ),
      streamText,
      statusText: fin.statusText,
      resultText,
      durationMs: fin.durationMs,
      runtimeLabel: fin.runtimeLabel,
      requestIp: requestIpStored,
      workspaceAppliedAtMs: list[i]?.workspaceAppliedAtMs ?? null,
    };

    if (i === -1) {
      const rip =
        fin.requestIp != null
          ? sanitizeRequestIpForStore(fin.requestIp)
          : sanitizeRequestIpForStore("");
      const dup = findRecentIdeHistoryDuplicateIndex(
        list,
        row.instruction,
        rip,
      );
      if (dup >= 0) {
        const prev = list[dup];
        if (prev.finishedAtMs != null && prev.state === fin.state) {
          return;
        }
        const canonicalId = prev.id;
        list[dup] = { ...prev, ...row, id: canonicalId };
        const pruned = list.filter((e, idx) => {
          if (idx === dup) return true;
          if (isDropableIdeInstructionDuplicate(e, row.instruction, canonicalId)) {
            return false;
          }
          if (e.id === id && id !== canonicalId) return false;
          return true;
        });
        await writeHistoryListAsync(pruned);
        return;
      }
      const prunedNew = list.filter(
        (e) => e.id !== id && !isDropableIdeInstructionDuplicate(e, row.instruction, id),
      );
      const next = [row, ...prunedNew].slice(0, OPS_AGENT_HISTORY_MAX);
      await writeHistoryListAsync(next);
      return;
    }

    const cur = list[i];
    if (cur.finishedAtMs != null && cur.state === fin.state) {
      return;
    }
    const merged = { ...list[i], ...row };
    const pruned =
      requestIpStored === "cursor-ide"
        ? list
            .map((e, idx) => (idx === i ? merged : e))
            .filter((e, idx) => {
              if (idx === i) return true;
              if (isDropableIdeInstructionDuplicate(e, merged.instruction, merged.id)) {
                return false;
              }
              return true;
            })
        : list.map((e, idx) => (idx === i ? merged : e));
    await writeHistoryListAsync(pruned);
    collapseIdeAgentHistoryDuplicatesSync();
  });
}

/**
 * 워크스페이스에 반영 완료로 표시(재실행 UI에서 막기 위함). running/waiting 은 불가.
 * @param {string} id
 * @param {boolean} applied true면 시각 기록, false면 해제
 * @returns {Promise<boolean>}
 */
export function setOpsHistoryWorkspaceApplied(id, applied) {
  return chainWrite(async () => {
    ensureDirSync();
    const raw = readRawListSync();
    const list = raw
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    const i = list.findIndex((e) => e.id === id);
    if (i === -1) return false;
    const cur = list[i];
    if (cur.state === "running" || cur.state === "waiting" || cur.state === "rejected")
      return false;
    list[i] = {
      ...cur,
      workspaceAppliedAtMs: applied ? Date.now() : null,
      updatedAtMs: Date.now(),
    };
    await writeHistoryListAsync(list);
    return true;
  });
}

/**
 * @param {object} entry
 * @returns {Promise<void>}
 */
export function appendOpsAgentHistoryEntry(entry) {
  return chainWrite(async () => {
    ensureDirSync();
    const parsed = parseHistoryRecord(entry);
    if (!parsed) return;
    const prev = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    let useId = parsed.id;
    const rip = sanitizeRequestIpForStore(parsed.requestIp);
    const dup = findRecentIdeHistoryDuplicateIndex(prev, parsed.instruction, rip);
    if (dup >= 0) useId = prev[dup].id;
    const row = { ...parsed, id: useId };
    const withoutDupes = prev.filter(
      (e) => e.id !== useId && !isDropableIdeInstructionDuplicate(e, row.instruction, useId),
    );
    const next = [row, ...withoutDupes].slice(0, OPS_AGENT_HISTORY_MAX);
    await writeHistoryListAsync(next);
  });
}

/** @returns {Promise<void>} */
export function clearOpsAgentHistoryAsync() {
  return chainWrite(async () => {
    ensureDirSync();
    const list = readRawListSync()
      .map((o) => parseHistoryRecord(/** @type {Record<string, unknown>} */ (o)))
      .filter(Boolean);
    for (const e of list) {
      if (e.state === "running") finalizeSkippedIds.add(e.id);
    }
    await writeHistoryListAsync([]);
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
    if (victim?.state === "running" || victim?.state === "waiting") {
      finalizeSkippedIds.add(id);
    }
    const next = list.filter((e) => e.id !== id);
    await writeHistoryListAsync(next);
  });
}

/**
 * @param {{
 *   instruction: string;
 *   phaseLine: string;
 *   cursorLine: string;
 *   thinkingLine: string;
 *   toolLine: string;
 *   toolLog: string;
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
    toolLog: trimStoredTextForOpsHistory(cap.toolLog ?? "", OPS_AGENT_TOOL_LOG_MAX_CHARS),
    streamText: trimStoredTextForOpsHistory(cap.streamText, OPS_AGENT_FIELD_MAX_CHARS),
    statusText: cap.statusText,
    resultText:
      cap.resultText != null
        ? trimStoredTextForOpsHistory(cap.resultText, OPS_AGENT_FIELD_MAX_CHARS)
        : null,
    durationMs: cap.durationMs,
    runtimeLabel: cap.runtimeLabel,
    requestIp: sanitizeRequestIpForStore(cap.requestIp ?? ""),
    workspaceAppliedAtMs: null,
  };
}
