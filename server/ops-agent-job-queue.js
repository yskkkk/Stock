/**
 * 웹 운영 에이전트(SSE·비스트리밍·기록 모드)와 Cursor IDE 채팅을
 * 하나의 FIFO로 직렬화한다. IDE는 서버에서 코드를 실행하지 않고,
 * 큐 차례가 오면 훅이 프롬프트 전송을 허용한다.
 */

import { randomUUID } from "node:crypto";
import {
  finalizeOpsAgentEntry,
  trimStoredTextForOpsHistory,
  upsertOpsAgentHistoryFromQueueSync,
} from "./ops-agent-history-store.js";
import { buildIdeQueueGrant } from "./ops-ide-queue-grant.js";
import {
  clearOpsWebAgentBusyMarkerSync,
  writeOpsWebAgentBusyMarker,
} from "./ops-web-agent-busy-marker.js";
import { mergeIdeLeaseDiskIntoAgentEntries } from "./ops-ide-lease-disk.js";
import {
  metaToPersistEntry,
  persistDevQueueRemove,
  persistDevQueueSetRunning,
  persistDevQueueUpsert,
  readDevQueueLiveAgentEntriesSync,
} from "./ops-dev-queue-live-store.js";
import { opsIdePromptsMatch } from "./ops-ide-prompt-match.js";

/**
 * @typedef {{
 *   id: string;
 *   requestIp: string;
 *   instructionPreview: string;
 *   instructionTooltip: string;
 *   instructionBody: string;
 *   enqueuedAtMs: number;
 *   source?: 'web' | 'ide';
 * }} OpsAgentQueueMeta
 */

/**
 * @typedef {{
 *   id: string;
 *   source: 'web' | 'ide';
 *   meta: OpsAgentQueueMeta | null;
 *   fn?: () => Promise<unknown>;
 *   resolve?: (v: unknown) => void;
 *   reject?: (e: unknown) => void;
 *   sessionId?: string | null;
 *   grantResolve?: (grant: Record<string, unknown>) => void;
 *   grantReject?: (e: unknown) => void;
 *   releaseResolve?: () => void;
 * }} QueueSlot
 */

/** @type {QueueSlot[]} */
const slots = [];
let active = false;

/** @type {OpsAgentQueueMeta | null} */
let runningMeta = null;

/** @type {QueueSlot | null} */
let runningSlot = null;

const MAX_WAITING = 25;
const OPS_QUEUE_INSTRUCTION_BODY_MAX = 16_000;
const IDE_ACQUIRE_TIMEOUT_MS = 45 * 60 * 1000;
const OPS_QUEUE_IP_MAX = 120;

const PREVIEW_MAX = 220;
const TOOLTIP_MAX = 900;
const TOOLTIP_MAX_LINES = 4;

/** @param {QueueSlot} slot */
function persistDevQueueWaiting(slot) {
  if (!slot.meta) return;
  persistDevQueueUpsert(metaToPersistEntry(slot.meta, "waiting"));
}

/** @param {QueueSlot} slot */
function persistDevQueueRunning(slot) {
  if (!slot.meta) return;
  persistDevQueueSetRunning(slot.id);
}

/** @param {string} slotId */
function persistDevQueueDone(slotId) {
  persistDevQueueRemove(slotId);
}

/** @param {unknown} ip */
function sanitizeQueueIp(ip) {
  return String(ip ?? "")
    .trim()
    .replace(/[\r\n\u0000]/g, "")
    .slice(0, OPS_QUEUE_IP_MAX);
}

/** @param {unknown} instruction */
function previewInstruction(instruction) {
  const line =
    String(instruction ?? "")
      .split(/\r?\n/)
      .find((l) => String(l).trim().length > 0) ?? "";
  const t = line.trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX - 1)}…` : t;
}

/** @param {unknown} instruction */
function tooltipInstruction(instruction) {
  const lines = String(instruction ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const chunk = lines.slice(0, TOOLTIP_MAX_LINES).join("\n");
  if (chunk.length <= TOOLTIP_MAX) return chunk;
  return `${chunk.slice(0, TOOLTIP_MAX - 1)}…`;
}

/** @param {{ requestIp?: string | null; instruction?: string; historyRunId?: string | null; source?: 'web' | 'ide' }} meta */
function buildQueueMeta(meta) {
  const source = meta.source === "ide" ? "ide" : "web";
  const id =
    typeof meta.historyRunId === "string" && meta.historyRunId.trim().length > 0
      ? meta.historyRunId.trim()
      : randomUUID();
  return {
    id,
    requestIp:
      source === "ide"
        ? "cursor-ide"
        : sanitizeQueueIp(meta.requestIp),
    instructionPreview: previewInstruction(meta.instruction),
    instructionTooltip: tooltipInstruction(meta.instruction),
    instructionBody: trimStoredTextForOpsHistory(
      String(meta.instruction ?? ""),
      OPS_QUEUE_INSTRUCTION_BODY_MAX,
    ),
    enqueuedAtMs: Date.now(),
    source,
  };
}

function waitingSlotCount() {
  return Math.max(0, slots.length - (active ? 1 : 0));
}

export function getOpsAgentQueueWaitingCount() {
  return waitingSlotCount();
}

export function isOpsAgentJobRunning() {
  return active;
}

/** @param {OpsAgentQueueMeta | null | undefined} meta */
function instructionTextFromMeta(meta) {
  if (!meta) return "";
  const body = String(meta.instructionBody ?? "").trim();
  if (body) return body;
  return String(meta.instructionPreview ?? "").trim();
}

/** @param {QueueSlot} slot */
function syncIdeHistoryWaiting(slot) {
  if (!slot.meta) return;
  upsertOpsAgentHistoryFromQueueSync(
    metaToPersistEntry(slot.meta, "waiting"),
  );
}

/** @param {QueueSlot} slot */
function syncIdeHistoryRunning(slot) {
  if (!slot.meta) return;
  upsertOpsAgentHistoryFromQueueSync(
    metaToPersistEntry(slot.meta, "running"),
  );
}

/**
 * @param {QueueSlot} slot
 * @param {"ok" | "error" | "cancelled"} state
 * @param {string | null} [error]
 */
function syncIdeHistoryFinalize(slot, state, error = null) {
  if (!slot.meta) return;
  const started = slot.meta.enqueuedAtMs ?? Date.now();
  void finalizeOpsAgentEntry(slot.id, {
    state,
    instruction: instructionTextFromMeta(slot.meta),
    requestIp: "cursor-ide",
    phaseLine: "Cursor IDE (단일 개발 큐)",
    cursorLine: "",
    thinkingLine: "",
    toolLine: "",
    toolLog: "",
    streamText: "",
    statusText: state === "ok" ? "IDE 세션 종료" : null,
    resultText:
      state === "ok"
        ? "Cursor IDE에서 요청이 완료되어 개발 큐에서 해제되었습니다."
        : null,
    durationMs: Math.max(0, Date.now() - started),
    runtimeLabel: "ide",
    error,
  }).catch(() => {
    /* ignore */
  });
}

export function getOpsAgentQueueSnapshot() {
  const waiting = [];
  for (let i = active ? 1 : 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.meta) {
      waiting.push({
        ...s.meta,
        source: s.meta.source === "ide" ? "ide" : "web",
        status: /** @type {const} */ ("waiting"),
      });
    }
  }
  const entries = [];
  if (active && runningMeta) {
    entries.push({
      ...runningMeta,
      source: runningMeta.source === "ide" ? "ide" : "web",
      status: /** @type {const} */ ("running"),
    });
  }
  entries.push(...waiting);
  const merged = mergeIdeLeaseDiskIntoAgentEntries(entries);
  const visible = merged.filter(
    (e) => String(e.requestIp ?? "").trim() !== "record-mode",
  );
  return { entries: visible };
}

function writeRunningBusyMarker() {
  if (!runningMeta) return;
  writeOpsWebAgentBusyMarker({
    runId: runningMeta.id,
    instructionPreview: runningMeta.instructionPreview,
    requestIp: runningMeta.requestIp,
    source: runningMeta.source === "ide" ? "ide" : "web",
  });
}

async function drainQueue() {
  if (active) return;
  const slot = slots[0];
  if (!slot) return;

  active = true;
  runningSlot = slot;
  runningMeta = slot.meta;
  writeRunningBusyMarker();
  persistDevQueueRunning(slot);

  if (slot.source === "web") {
    try {
      if (!slot.fn) throw new Error("웹 큐 작업 함수가 없습니다.");
      const out = await slot.fn();
      slot.resolve?.(out);
    } catch (e) {
      slot.reject?.(e);
    } finally {
      slots.shift();
      active = false;
      runningSlot = null;
      runningMeta = null;
      clearOpsWebAgentBusyMarkerSync();
      persistDevQueueDone(slot.id);
      void drainQueue();
    }
    return;
  }

  let ideHistoryFinalized = false;
  const finishIdeHistory = (/** @type {"ok" | "error" | "cancelled"} */ state, err = null) => {
    if (ideHistoryFinalized) return;
    ideHistoryFinalized = true;
    syncIdeHistoryFinalize(slot, state, err);
  };

  try {
    syncIdeHistoryRunning(slot);
    const waitedMs = Date.now() - (slot.meta?.enqueuedAtMs ?? Date.now());
    const queueSeq =
      slots.findIndex((s) => s.id === slot.id) >= 0
        ? slots.findIndex((s) => s.id === slot.id) + 1
        : 1;
    const grant = buildIdeQueueGrant({
      leaseId: slot.id,
      waitedMs,
      queueSeq,
    });
    /** @type {{ settledGrant?: Record<string, unknown> }} */ (slot).settledGrant =
      grant;
    slot.grantResolve?.(grant);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error("IDE 개발 큐 슬롯이 시간 초과되었습니다."));
      }, IDE_ACQUIRE_TIMEOUT_MS);
      slot.releaseResolve = () => {
        clearTimeout(t);
        resolve();
      };
    });
    finishIdeHistory("ok");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finishIdeHistory("error", msg || "IDE 큐 오류");
    slot.grantReject?.(e);
  } finally {
    slots.shift();
    active = false;
    runningSlot = null;
    runningMeta = null;
    clearOpsWebAgentBusyMarkerSync();
    persistDevQueueDone(slot.id);
    void drainQueue();
  }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {() => void} [onQueued]
 * @param {{ requestIp?: string | null; instruction?: string; historyRunId?: string | null }} [meta]
 * @param {() => void} [onCommittedToQueue]
 * @returns {Promise<T>}
 */
export function enqueueOpsAgentJob(fn, onQueued, meta, onCommittedToQueue) {
  const waiting = waitingSlotCount();
  if (waiting >= MAX_WAITING) {
    const err = new Error(
      "운영 에이전트 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.",
    );
    err.code = "OPS_QUEUE_FULL";
    return Promise.reject(err);
  }

  const queueMeta = meta != null ? buildQueueMeta({ ...meta, source: "web" }) : null;

  return new Promise((resolve, reject) => {
    const willWaitBehindRunningJob = active || slots.length > 0;
    const slot = /** @type {QueueSlot} */ ({
      id: queueMeta?.id ?? randomUUID(),
      source: "web",
      meta: queueMeta,
      fn,
      resolve,
      reject,
    });
    slots.push(slot);
    persistDevQueueWaiting(slot);
    try {
      onCommittedToQueue?.();
    } catch {
      /* ignore */
    }
    if (willWaitBehindRunningJob) {
      try {
        onQueued?.();
      } catch {
        /* ignore */
      }
    }
    void drainQueue();
  });
}

/** @param {string} slotId */
function queueSeqAndStatusForSlotId(slotId) {
  const snap = getOpsAgentQueueSnapshot();
  const idx = snap.entries.findIndex((e) => e.id === slotId);
  const queueSeq = idx >= 0 ? idx + 1 : snap.entries.length + 1;
  const hit = idx >= 0 ? snap.entries[idx] : null;
  const queueStatus =
    runningMeta?.id === slotId || hit?.status === "running" ? "running" : "waiting";
  return { queueSeq, queueStatus };
}

/**
 * IDE 요청을 큐에 즉시 등록(웹 에이전트 대기 등록과 동일하게 스냅샷에 바로 표시).
 * @param {{ prompt: string; sessionId?: string | null }} input
 */
/** @param {string} prompt */
export function hasActiveIdeSlotForPrompt(prompt) {
  if (findActiveIdeSlotByPrompt(prompt) != null) return true;
  const probe = String(prompt ?? "").trim();
  if (!probe) return false;
  for (const e of readDevQueueLiveAgentEntriesSync()) {
    if (e.source !== "ide" && e.requestIp !== "cursor-ide") continue;
    const preview = String(e.instructionPreview ?? "").trim();
    const body = String(e.instructionBody ?? "").trim();
    const text = body || preview;
    if (text && opsIdePromptsMatch(text, probe)) return true;
  }
  return false;
}

/** @param {string} prompt */
function findActiveIdeSlotByPrompt(prompt) {
  const probe = String(prompt ?? "").trim();
  if (!probe) return null;
  for (const s of slots) {
    if (s.source !== "ide" || !s.meta) continue;
    if (opsIdePromptsMatch(instructionTextFromMeta(s.meta), probe)) return s;
  }
  return null;
}

/**
 * 실행 중 IDE 슬롯이 새 프롬프트와 다를 때만 해제(같은 턴이면 유지).
 * @param {string} prompt
 */
export function releaseRunningIdeDevQueueIfDifferentPrompt(prompt) {
  if (!active || runningSlot?.source !== "ide" || !runningMeta) {
    return { ok: true, skipped: true };
  }
  if (opsIdePromptsMatch(instructionTextFromMeta(runningMeta), prompt)) {
    return { ok: true, skipped: true, samePrompt: true };
  }
  return releaseIdeDevQueueSlot({ leaseId: runningSlot.id });
}

export function registerIdeDevQueueSlot(input) {
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) {
    const err = new Error("prompt가 비어 있습니다.");
    err.code = "IDE_PROMPT_EMPTY";
    throw err;
  }

  const existing = findActiveIdeSlotByPrompt(prompt);
  if (existing?.meta) {
    const leaseId = existing.id;
    const { queueSeq, queueStatus } = queueSeqAndStatusForSlotId(leaseId);
    return {
      ok: true,
      leaseId,
      queueStatus,
      queueSeq,
      instructionPreview: existing.meta.instructionPreview,
      instructionTooltip: existing.meta.instructionTooltip,
      enqueuedAtMs: existing.meta.enqueuedAtMs,
      deduped: true,
    };
  }

  const sessionId = String(input.sessionId ?? "").trim() || null;
  const waiting = waitingSlotCount();
  if (waiting >= MAX_WAITING) {
    const err = new Error(
      "개발 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.",
    );
    err.code = "OPS_QUEUE_FULL";
    throw err;
  }

  if (
    sessionId &&
    (slots.some(
      (s) =>
        s.source === "ide" &&
        s.sessionId === sessionId &&
        (s === slots[0] || slots.indexOf(s) > 0),
    ) ||
      readDevQueueLiveAgentEntriesSync().some(
        (e) =>
          (e.source === "ide" || e.requestIp === "cursor-ide") &&
          String(e.sessionId ?? "") === sessionId,
      ))
  ) {
    const err = new Error(
      "이 Cursor 세션에 이미 대기·실행 중인 IDE 요청이 있습니다. 끝난 뒤 다시 보내세요.",
    );
    err.code = "IDE_SESSION_BUSY";
    throw err;
  }

  const queueMeta = buildQueueMeta({
    instruction: prompt,
    requestIp: "cursor-ide",
    source: "ide",
  });

  const slot = /** @type {QueueSlot} */ ({
    id: queueMeta.id,
    source: "ide",
    meta: queueMeta,
    sessionId,
  });
  slots.push(slot);
  const waitingEntry = {
    ...metaToPersistEntry(queueMeta, "waiting"),
    sessionId,
  };
  persistDevQueueUpsert(waitingEntry);
  syncIdeHistoryWaiting(slot);
  void drainQueue();

  const leaseId = slot.id;
  const { queueSeq, queueStatus } = queueSeqAndStatusForSlotId(leaseId);

  return {
    ok: true,
    leaseId,
    queueStatus,
    queueSeq,
    instructionPreview: queueMeta.instructionPreview,
    instructionTooltip: queueMeta.instructionTooltip,
    enqueuedAtMs: queueMeta.enqueuedAtMs,
  };
}

/**
 * register 직후 호출 — 실행 차례가 오면 grant 반환.
 * @param {string} leaseId
 */
export function waitIdeDevQueueGrant(leaseId) {
  const id = String(leaseId ?? "").trim();
  if (!id) {
    return Promise.reject(new Error("leaseId가 필요합니다."));
  }

  const slot = slots.find((s) => s.id === id && s.source === "ide");
  if (!slot) {
    const err = new Error("개발 큐에 등록된 IDE 요청을 찾을 수 없습니다.");
    err.code = "IDE_LEASE_NOT_FOUND";
    return Promise.reject(err);
  }

  /** @type {Record<string, unknown> | undefined} */
  const settled = /** @type {{ settledGrant?: Record<string, unknown> }} */ (slot)
    .settledGrant;
  if (settled) return Promise.resolve(settled);

  return new Promise((resolve, reject) => {
    slot.grantResolve = (grant) => {
      /** @type {{ settledGrant?: Record<string, unknown> }} */ (slot).settledGrant =
        grant;
      resolve(grant);
    };
    slot.grantReject = reject;
  });
}

/**
 * Cursor IDE — 큐 등록 + 차례까지 대기(레거시 단일 HTTP용).
 * @param {{ prompt: string; sessionId?: string | null }} input
 */
export async function acquireIdeDevQueueSlot(input) {
  const reg = registerIdeDevQueueSlot(input);
  const grant = await waitIdeDevQueueGrant(reg.leaseId);
  return { ok: true, ...grant, queueSeq: reg.queueSeq };
}

/**
 * 대기·실행 중 IDE 슬롯을 큐에서 제거(훅 타임아웃·세션 종료 시 정리).
 * @param {string} leaseId
 */
export function abandonIdeDevQueueSlot(leaseId) {
  const id = String(leaseId ?? "").trim();
  if (!id) return { ok: false, error: "leaseId가 필요합니다." };

  const idx = slots.findIndex((s) => s.id === id && s.source === "ide");
  if (idx < 0) {
    persistDevQueueRemove(id);
    return { ok: true, cancelled: true, fromPersistOnly: true };
  }

  const slot = slots[idx];
  if (active && runningSlot?.id === id) {
    try {
      slot.releaseResolve?.();
    } catch {
      /* ignore */
    }
    return { ok: true, released: true };
  }

  slots.splice(idx, 1);
  const err = new Error("IDE 개발 큐 요청이 취소되었습니다.");
  err.code = "IDE_QUEUE_CANCELLED";
  try {
    slot.grantReject?.(err);
  } catch {
    /* ignore */
  }
  syncIdeHistoryFinalize(slot, "cancelled");
  persistDevQueueRemove(id);
  if (!active) {
    clearOpsWebAgentBusyMarkerSync();
    void drainQueue();
  }
  return { ok: true, cancelled: true };
}

/**
 * @param {{ leaseId: string }} input
 * @returns {{ ok: boolean; error?: string }}
 */
export function releaseIdeDevQueueSlot(input) {
  const leaseId = String(input.leaseId ?? "").trim();
  if (!leaseId) return { ok: false, error: "leaseId가 필요합니다." };

  const slot = runningSlot;
  if (!slot || slot.source !== "ide" || slot.id !== leaseId) {
    const abandoned = abandonIdeDevQueueSlot(leaseId);
    if (abandoned.ok) return { ok: true };
    return {
      ok: false,
      error: "해당 IDE 슬롯이 실행 중이 아닙니다.",
    };
  }

  try {
    slot.releaseResolve?.();
  } catch {
    /* ignore */
  }
  return { ok: true };
}

/**
 * 에이전트 턴 종료·훅 release — 실행 중 IDE 슬롯 + 고아 lease 정리.
 * @returns {{ ok: boolean; released?: boolean; cleared?: boolean }}
 */
export function releaseAnyRunningIdeDevQueueSlot() {
  let released = false;

  if (active && runningSlot?.source === "ide") {
    const out = releaseIdeDevQueueSlot({ leaseId: runningSlot.id });
    released = out.ok;
  }

  if (!released) {
    for (let i = slots.length - 1; i >= 0; i--) {
      const s = slots[i];
      if (s.source !== "ide") continue;
      if (active && runningSlot?.id === s.id) continue;
      const ab = abandonIdeDevQueueSlot(s.id);
      if (ab.ok) released = true;
    }
  }

  if (!released) {
    for (const e of readDevQueueLiveAgentEntriesSync()) {
      if (e.status !== "running") continue;
      if (e.source !== "ide" && e.requestIp !== "cursor-ide") continue;
      const id = String(e.id ?? "").trim();
      if (!id) continue;
      const ins = String(e.instructionBody ?? e.instructionPreview ?? "").trim();
      void finalizeOpsAgentEntry(id, {
        state: "ok",
        instruction: ins,
        requestIp: "cursor-ide",
        phaseLine: "Cursor IDE (단일 개발 큐)",
        cursorLine: "",
        thinkingLine: "",
        toolLine: "",
        toolLog: "",
        streamText: "",
        statusText: "IDE 세션 종료",
        resultText:
          "Cursor IDE에서 요청이 완료되어 개발 큐에서 해제되었습니다.",
        durationMs: Math.max(
          0,
          Date.now() -
            (typeof e.enqueuedAtMs === "number" ? e.enqueuedAtMs : Date.now()),
        ),
        runtimeLabel: "ide",
        error: null,
      });
      persistDevQueueRemove(id);
      released = true;
      break;
    }
  }

  return { ok: true, released };
}
