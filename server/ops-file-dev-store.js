/**
 * 운영 탭「파일 반영」— 에이전트·작업 큐와 무관하게 JSON만 읽어 순차 디스크 반영.
 * server/.data/ops-file-dev-queue.json
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const QUEUE_FILE = path.join(DATA_DIR, "ops-file-dev-queue.json");

const MAX_ITEMS = 48;
const MAX_REQUEST_JSON_CHARS = 900_000;
const STALE_RUNNING_MS = 25 * 60 * 1000;
const MAX_FINGERPRINTS = 500;

/** @typedef {"pending" | "running" | "applied" | "error"} FileDevStatus */

/**
 * @typedef {{
 *   id: string;
 *   requestJson: string;
 *   fingerprint: string;
 *   status: FileDevStatus;
 *   createdAtMs: number;
 *   lockedAtMs?: number | null;
 *   updatedAtMs?: number | null;
 *   error?: string | null;
 *   applySummary?: string | null;
 * }} FileDevItem */

let writeChain = /** @type {Promise<unknown>} */ (Promise.resolve());

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

/** @param {string} body */
export function fingerprintFileDevRequest(body) {
  const t = String(body ?? "").trim();
  return createHash("sha256").update(t, "utf8").digest("hex");
}

/** @param {Record<string, unknown>} o @returns {FileDevItem | null} */
function parseItem(o) {
  const id = typeof o.id === "string" && o.id.trim().length > 0 ? o.id.trim() : "";
  if (!id) return null;
  const requestJson = String(o.requestJson ?? "").slice(0, MAX_REQUEST_JSON_CHARS);
  const fpRaw = o.fingerprint;
  const fingerprint =
    typeof fpRaw === "string" && fpRaw.trim().length >= 32
      ? fpRaw.trim().slice(0, 128)
      : fingerprintFileDevRequest(requestJson);
  const st = o.status;
  const status =
    st === "pending" || st === "running" || st === "applied" || st === "error" ? st : "pending";
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
  const sumRaw = o.applySummary;
  const applySummary =
    sumRaw === null || sumRaw === undefined
      ? null
      : typeof sumRaw === "string"
        ? sumRaw.slice(0, 4000)
        : null;
  return {
    id,
    requestJson,
    fingerprint,
    status,
    createdAtMs,
    lockedAtMs,
    updatedAtMs,
    error,
    applySummary,
  };
}

/** @returns {{ appliedFingerprints: string[]; items: FileDevItem[] }} */
export function readFileDevQueueSync() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return { appliedFingerprints: [], items: [] };
    const raw = fs.readFileSync(QUEUE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return { appliedFingerprints: [], items: [] };
    const fpArr = parsed.appliedFingerprints;
    const appliedFingerprints = Array.isArray(fpArr)
      ? fpArr.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 32)
      : [];
    const arr = parsed.items;
    if (!Array.isArray(arr)) return { appliedFingerprints, items: [] };
    const items = arr
      .map((x) => (isPlainObject(x) ? parseItem(/** @type {Record<string, unknown>} */ (x)) : null))
      .filter(Boolean);
    return { appliedFingerprints, items: /** @type {FileDevItem[]} */ (items) };
  } catch {
    return { appliedFingerprints: [], items: [] };
  }
}

/**
 * @param {{ appliedFingerprints: string[]; items: FileDevItem[] }} data
 */
function writeQueueSync(data) {
  ensureDirSync();
  const fps = [...new Set(data.appliedFingerprints.filter(Boolean))].slice(-MAX_FINGERPRINTS);
  fs.writeFileSync(
    QUEUE_FILE,
    JSON.stringify({ appliedFingerprints: fps, items: data.items }, null, 0),
    "utf8",
  );
}

/**
 * @param {FileDevItem[]} items
 */
export function resetStaleFileDevRunningInPlace(items) {
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

export const FILE_DEV_POLL_MS =
  Number(process.env.OPS_FILE_DEV_POLL_MS) > 3000
    ? Math.min(120_000, Math.floor(Number(process.env.OPS_FILE_DEV_POLL_MS)))
    : 12_000;

/**
 * @param {unknown[]} incomingRaw
 * @returns {Promise<{ appliedFingerprints: string[]; items: FileDevItem[]; pollIntervalMs: number }>}
 */
export function mergeFileDevQueueFromClient(incomingRaw) {
  return chain(async () => {
    const disk = readFileDevQueueSync();
    const diskById = new Map(disk.items.map((x) => [x.id, x]));
    const fpGlobal = new Set(disk.appliedFingerprints);
    const incoming = Array.isArray(incomingRaw) ? incomingRaw : [];

    /** @type {FileDevItem[]} */
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
      const body = parsed.requestJson.trim().slice(0, MAX_REQUEST_JSON_CHARS);
      const fp = fingerprintFileDevRequest(body);
      let st = parsed.status;
      if (st === "running") st = "pending";
      if (st !== "pending" && st !== "applied" && st !== "error") st = "pending";
      let applySummary = parsed.applySummary ?? null;
      let err = st === "error" ? (parsed.error ?? d?.error ?? null) : null;
      if (st === "pending" && fpGlobal.has(fp)) {
        st = "applied";
        applySummary = "동일 지문은 이미 반영되어 건너뜀(중복)";
        err = null;
      }
      out.push({
        id: parsed.id,
        requestJson: body.length > 0 ? body : (d?.requestJson ?? "").slice(0, MAX_REQUEST_JSON_CHARS),
        fingerprint: fp,
        status: st,
        createdAtMs: d?.createdAtMs ?? parsed.createdAtMs,
        lockedAtMs: null,
        updatedAtMs: Date.now(),
        error: err,
        applySummary,
      });
      seen.add(parsed.id);
    }

    for (const d of disk.items) {
      if (d.status === "running" && !seen.has(d.id)) {
        out.push({ ...d });
      }
    }

    const trimmed = out.slice(0, MAX_ITEMS);
    writeQueueSync({ appliedFingerprints: disk.appliedFingerprints, items: trimmed });
    return { appliedFingerprints: disk.appliedFingerprints, items: trimmed, pollIntervalMs: FILE_DEV_POLL_MS };
  });
}

/**
 * 웹/API에서 JSON 한 건을 큐 파일에 `pending`으로 추가(목록 저장 버튼 없이).
 * 용량 초과 시 applied·error 항목을 앞에서부터 제거해 공간을 만든다.
 * @param {string} requestJsonRaw
 * @returns {Promise<
 *   | { ok: true; id: string; items: FileDevItem[]; appliedFingerprints: string[]; pollIntervalMs: number }
 *   | { ok: false; code: "EMPTY" | "QUEUE_FULL" }
 * >}
 */
export function appendFileDevPendingJob(requestJsonRaw) {
  return chain(async () => {
    const body = String(requestJsonRaw ?? "")
      .trim()
      .slice(0, MAX_REQUEST_JSON_CHARS);
    if (!body) {
      return { ok: false, code: /** @type {const} */ ("EMPTY") };
    }
    const fp = fingerprintFileDevRequest(body);
    const data = readFileDevQueueSync();
    resetStaleFileDevRunningInPlace(data.items);

    while (data.items.length >= MAX_ITEMS) {
      const i = data.items.findIndex((x) => x.status === "applied" || x.status === "error");
      if (i === -1) {
        return { ok: false, code: /** @type {const} */ ("QUEUE_FULL") };
      }
      data.items.splice(i, 1);
    }

    const now = Date.now();
    const id = randomUUID();
    data.items.push({
      id,
      requestJson: body,
      fingerprint: fp,
      status: "pending",
      createdAtMs: now,
      lockedAtMs: null,
      updatedAtMs: now,
      error: null,
      applySummary: null,
    });
    writeQueueSync(data);
    return {
      ok: true,
      id,
      items: data.items,
      appliedFingerprints: data.appliedFingerprints,
      pollIntervalMs: FILE_DEV_POLL_MS,
    };
  });
}

/**
 * 다음 pending 한 건을 running으로 잡거나, 지문 중복이면 applied로만 갱신.
 * @returns {Promise<{ id: string; requestJson: string; fingerprint: string } | null>}
 */
export function claimNextPendingFileDevJob() {
  return chain(async () => {
    const data = readFileDevQueueSync();
    resetStaleFileDevRunningInPlace(data.items);
    const fpSeen = new Set(data.appliedFingerprints);
    const now = Date.now();
    let claimed = null;

    for (let i = 0; i < data.items.length; i++) {
      const it = data.items[i];
      if (it.status !== "pending" || !it.requestJson.trim()) continue;
      const fp = it.fingerprint || fingerprintFileDevRequest(it.requestJson);
      it.fingerprint = fp;
      if (fpSeen.has(fp)) {
        data.items[i] = {
          ...it,
          status: "applied",
          lockedAtMs: null,
          updatedAtMs: now,
          error: null,
          applySummary: "동일 지문은 이미 반영되어 건너뜀(중복)",
        };
        continue;
      }
      data.items[i] = {
        ...it,
        status: "running",
        lockedAtMs: now,
        updatedAtMs: now,
        error: null,
      };
      claimed = { id: it.id, requestJson: it.requestJson, fingerprint: fp };
      break;
    }

    writeQueueSync(data);
    return claimed;
  });
}

/**
 * @param {string} id
 * @param {string} fingerprint
 * @param {string} summary
 */
export function finalizeFileDevApplied(id, fingerprint, summary) {
  return chain(async () => {
    const data = readFileDevQueueSync();
    const i = data.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    const now = Date.now();
    const cur = data.items[i];
    const fps = new Set(data.appliedFingerprints);
    fps.add(fingerprint);
    data.appliedFingerprints = [...fps].slice(-MAX_FINGERPRINTS);
    data.items[i] = {
      ...cur,
      status: "applied",
      lockedAtMs: null,
      updatedAtMs: now,
      error: null,
      applySummary: summary.slice(0, 4000),
      fingerprint,
    };
    writeQueueSync(data);
  });
}

/**
 * @param {string} id
 * @param {string} message
 */
export function finalizeFileDevError(id, message) {
  return chain(async () => {
    const data = readFileDevQueueSync();
    const i = data.items.findIndex((x) => x.id === id);
    if (i === -1) return;
    const now = Date.now();
    const cur = data.items[i];
    data.items[i] = {
      ...cur,
      status: "error",
      lockedAtMs: null,
      updatedAtMs: now,
      error: message.slice(0, 4000),
    };
    writeQueueSync(data);
  });
}

/**
 * @param {string} id
 */
export function revertFileDevJobToPending(id) {
  return chain(async () => {
    const data = readFileDevQueueSync();
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
