/**
 * 운영 탭「기록 모드」— 서버가 주기적으로 읽어 Cursor 에이전트(비스트리밍)로 순차 실행.
 * 상태·대기 목록: server/.data/ops-record-mode-queue.json
 * 실행 기록(추가 전용): server/.data/ops-record-mode-activity.log
 * (대시보드「에이전트 실행 큐」UI에는 넣지 않음 — 워커 직렬화만 동일 큐 모듈 사용, meta 생략)
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const QUEUE_FILE = path.join(DATA_DIR, "ops-record-mode-queue.json");
const ACTIVITY_LOG = path.join(DATA_DIR, "ops-record-mode-activity.log");
const ACTIVITY_FIELD_MAX = 12_000;

const MAX_ITEMS = 32;
const MAX_INSTRUCTION_CHARS = 14_000;
const STALE_RUNNING_MS = 35 * 60 * 1000;

/** @typedef {{ id: string; instruction: string; status: "pending" | "running" | "done" | "error"; createdAtMs: number; lockedAtMs?: number | null; updatedAtMs?: number | null; error?: string | null }} RecordModeItem */

let writeChain = Promise.resolve();

/**
 * @param {() => Promise<void>} fn
 */
function chain(fn) {
  const p = writeChain.then(fn);
  writeChain = p.catch(() => {});
  return p;
}

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @param {unknown} x */
function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** @param {Record<string, unknown>} o @returns {RecordModeItem | null} */
function parseItem(o) {
  const id = typeof o.id === "string" && o.id.trim().length > 0 ? o.id.trim() : "";
  if (!id) return null;
  const instruction = String(o.instruction ?? "");
  const st = o.status;
  const status =
    st === "pending" || st === "running" || st === "done" || st === "error" ? st : "pending";
  const createdRaw = o.createdAtMs;
  const createdAtMs =
    typeof createdRaw === "number" && Number.isFinite(createdRaw) ? createdRaw : Date.now();
  const lockedRaw = o.lockedAtMs;
  const lockedAtMs =
    lockedRaw === null || lockedRaw === undefined
      ? null
      : typeof lockedRaw === "number" && Number.isFinite(lockedRaw)
        ? lockedRaw
        : null;
  const updatedRaw = o.updatedAtMs;
  const updatedAtMs =
    typeof updatedRaw === "number" && Number.isFinite(updatedRaw) ? updatedRaw : null;
  const errRaw = o.error;
  const error =
    typeof errRaw === "string" && errRaw.trim().length > 0 ? errRaw.trim().slice(0, 4000) : null;
  return {
    id,
    instruction: instruction.slice(0, MAX_INSTRUCTION_CHARS),
    status,
    createdAtMs,
    lockedAtMs,
    updatedAtMs,
    error,
  };
}

/** @returns {{ items: RecordModeItem[] }} */
export function readRecordModeQueueSync() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return { items: [] };
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return { items: [] };
    const arr = parsed.items;
    if (!Array.isArray(arr)) return { items: [] };
    const items = arr
      .map((x) => (isPlainObject(x) ? parseItem(/** @type {Record<string, unknown>} */ (x)) : null))
      .filter(Boolean);
    return { items: /** @type {RecordModeItem[]} */ (items) };
  } catch {
    return { items: [] };
  }
}

/**
 * 오래 `running`에 묶인 행 복구(크래시 등)
 * @param {RecordModeItem[]} items
 */
export function resetStaleRunningInPlace(items) {
  const now = Date.now();
  for (const it of items) {
    if (it.status !== "running") continue;
    const t = it.lockedAtMs ?? it.updatedAtMs ?? it.createdAtMs;
    if (now - t > STALE_RUNNING_MS) {
      it.status = "pending";
      it.lockedAtMs = null;
      it.error = null;
      it.updatedAtMs = now;
    }
  }
}

/**
 * @param {{ items: RecordModeItem[] }} data
 */
function writeQueueSync(data) {
  ensureDirSync();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 0), "utf8");
}

/**
 * 클라이언트가 보낸 목록과 디스크를 병합(실행 중 행은 서버가 우선).
 * @param {unknown[]} incomingRaw
 * @returns {Promise<{ items: RecordModeItem[] }>}
 */
export function mergeRecordModeQueueFromClient(incomingRaw) {
  return chain(async () => {
    const disk = readRecordModeQueueSync();
    const diskById = new Map(disk.items.map((x) => [x.id, x]));
    const incoming = Array.isArray(incomingRaw) ? incomingRaw : [];

    /** @type {RecordModeItem[]} */
    const out = [];
    const seen = new Set();

    for (const raw of incoming) {
      if (!isPlainObject(raw)) continue;
      const parsed = parseItem(/** @type {Record<string, unknown>} */ (raw));
      if (!parsed) continue;
      const d = diskById.get(parsed.id);
      if (d?.status === "running") {
        out.push({ ...d });
        seen.add(d.id);
        continue;
      }
      const ins = parsed.instruction.trim().slice(0, MAX_INSTRUCTION_CHARS);
      let st = parsed.status;
      if (st === "running") st = "pending";
      if (st !== "pending" && st !== "done" && st !== "error") st = "pending";
      out.push({
        id: parsed.id,
        instruction: ins.length > 0 ? ins : (d?.instruction ?? "").slice(0, MAX_INSTRUCTION_CHARS),
        status: st,
        createdAtMs: d?.createdAtMs ?? parsed.createdAtMs,
        lockedAtMs: null,
        updatedAtMs: Date.now(),
        error: st === "error" ? (parsed.error ?? d?.error ?? null) : null,
      });
      seen.add(parsed.id);
    }

    for (const d of disk.items) {
      if (d.status === "running" && !seen.has(d.id)) {
        out.push({ ...d });
      }
    }

    const trimmed = out.slice(0, MAX_ITEMS);
    writeQueueSync({ items: trimmed });
    return { items: trimmed };
  });
}

/**
 * 다음 `pending` 한 건을 `running`으로 바꾼 뒌 내용을 반환(원자적).
 * @returns {Promise<{ id: string; instruction: string } | null>}
 */
export function claimNextPendingRecordJob() {
  return chain(async () => {
    const data = readRecordModeQueueSync();
    resetStaleRunningInPlace(data.items);
    const idx = data.items.findIndex(
      (it) => it.status === "pending" && it.instruction.trim().length > 0,
    );
    if (idx === -1) {
      writeQueueSync(data);
      return null;
    }
    const it = data.items[idx];
    const now = Date.now();
    const next = {
      ...it,
      status: /** @type {const} */ ("running"),
      lockedAtMs: now,
      updatedAtMs: now,
      error: null,
    };
    data.items[idx] = next;
    writeQueueSync(data);
    return { id: next.id, instruction: next.instruction.trim() };
  });
}

/**
 * @param {string} id
 * @param {"pending" | "done" | "error"} status
 * @param {string | null} [error]
 */
export function updateRecordModeItemStatus(id, status, error = null) {
  return chain(async () => {
    const data = readRecordModeQueueSync();
    const i = data.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    const now = Date.now();
    const cur = data.items[i];
    data.items[i] = {
      ...cur,
      status,
      lockedAtMs: null,
      updatedAtMs: now,
      error: status === "error" ? (error ?? cur.error ?? "오류") : null,
    };
    writeQueueSync(data);
  });
}

/**
 * `enqueueOpsAgentJob` 실패(대기열 가득 참) 시 `pending`으로 되돌림.
 * @param {string} id
 */
export function revertRecordModeJobToPending(id) {
  return chain(async () => {
    const data = readRecordModeQueueSync();
    const i = data.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    const cur = data.items[i];
    if (cur.status !== "running") return;
    const now = Date.now();
    data.items[i] = {
      ...cur,
      status: "pending",
      lockedAtMs: null,
      updatedAtMs: now,
      error: null,
    };
    writeQueueSync(data);
  });
}

export const RECORD_MODE_REQUEST_IP = "record-mode";
export const RECORD_MODE_POLL_MS = 10_000;

/**
 * 기록 모드 전용 활동 로그(JSONL, 한 줄 한 이벤트). 대시보드 에이전트 큐와 별도.
 * @param {{ event: "start" | "ok" | "error"; id: string; instruction?: string; message?: string | null }} rec
 */
export function appendRecordModeActivityLog(rec) {
  ensureDirSync();
  const payload = {
    iso: new Date().toISOString(),
    source: "record-mode",
    ...rec,
  };
  for (const k of /** @type {const} */ (["instruction", "message"])) {
    const v = payload[k];
    if (typeof v === "string" && v.length > ACTIVITY_FIELD_MAX) {
      payload[k] = `${v.slice(0, ACTIVITY_FIELD_MAX)}\n…(truncated)`;
    }
  }
  try {
    fs.appendFileSync(ACTIVITY_LOG, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    /* 디스크 실패는 조용히 무시 */
  }
}
