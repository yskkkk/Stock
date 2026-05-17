/**
 * Cursor 운영 에이전트는 동시에 여러 개 돌리면 git/워킹트리 충돌이 나기 쉬움.
 * 모든 SSE·비스트리밍 실행을 단일 워커 FIFO 큐로 직렬화한다.
 */

import { randomUUID } from "node:crypto";

/**
 * @typedef {{
 *   id: string;
 *   requestIp: string;
 *   instructionPreview: string;
 *   instructionTooltip: string;
 *   enqueuedAtMs: number;
 * }} OpsAgentQueueMeta
 */

/** @typedef {{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; meta: OpsAgentQueueMeta | null }} QueuedJob */

const queue = /** @type {QueuedJob[]} */ ([]);
let busy = false;

/** @type {OpsAgentQueueMeta | null} */
let runningMeta = null;

/** 대기만 제한 (실행 중 1건은 별도). 과하면 503 */
const MAX_WAITING = 25;

const OPS_QUEUE_IP_MAX = 120;

/** @param {unknown} ip */
function sanitizeQueueIp(ip) {
  return String(ip ?? "")
    .trim()
    .replace(/[\r\n\u0000]/g, "")
    .slice(0, OPS_QUEUE_IP_MAX);
}

const PREVIEW_MAX = 220;
const TOOLTIP_MAX = 900;
const TOOLTIP_MAX_LINES = 4;

/** @param {unknown} instruction */
function previewInstruction(instruction) {
  const line =
    String(instruction ?? "")
      .split(/\r?\n/)
      .find((l) => String(l).trim().length > 0) ?? "";
  const t = line.trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX - 1)}…` : t;
}

/** @param {unknown} instruction — 네이티브 title용 (여러 줄) */
function tooltipInstruction(instruction) {
  const lines = String(instruction ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const chunk = lines.slice(0, TOOLTIP_MAX_LINES).join("\n");
  if (chunk.length <= TOOLTIP_MAX) return chunk;
  return `${chunk.slice(0, TOOLTIP_MAX - 1)}…`;
}

export function getOpsAgentQueueWaitingCount() {
  return queue.length;
}

export function isOpsAgentJobRunning() {
  return busy;
}

/**
 * 관리자 UI 폴링용 — **실행 중인 작업만** 노출(FIFO 대기는 제외). 완료 시 서버 메모리에서 제거됨.
 * @returns {{ entries: Array<{ id: string; requestIp: string; instructionPreview: string; instructionTooltip: string; enqueuedAtMs: number; status: 'running' }> }}
 */
export function getOpsAgentQueueSnapshot() {
  const entries = [];
  if (runningMeta) {
    entries.push({ ...runningMeta, status: /** @type {const} */ ("running") });
  }
  return { entries };
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {() => void} [onQueued] busy일 때 이번 요청이 대기열에만 들어간 직후(헤더·SSE를 먼저 열 때)
 * @param {{ requestIp?: string | null; instruction?: string }} [meta]
 * @param {() => void} [onCommittedToQueue] 큐에 push된 직후(`drainQueue`보다 먼저) — 필요 시 훅
 * @returns {Promise<T>}
 */
export function enqueueOpsAgentJob(fn, onQueued, meta, onCommittedToQueue) {
  if (queue.length >= MAX_WAITING) {
    const err = new Error(
      "운영 에이전트 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.",
    );
    err.code = "OPS_QUEUE_FULL";
    return Promise.reject(err);
  }

  const queueMeta =
    meta != null
      ? {
          id: randomUUID(),
          requestIp: sanitizeQueueIp(meta.requestIp),
          instructionPreview: previewInstruction(meta.instruction),
          instructionTooltip: tooltipInstruction(meta.instruction),
          enqueuedAtMs: Date.now(),
        }
      : null;

  return new Promise((resolve, reject) => {
    const willWaitBehindRunningJob = busy;
    queue.push({ fn, resolve, reject, meta: queueMeta });
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

async function drainQueue() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  runningMeta = job.meta;
  try {
    const out = await job.fn();
    job.resolve(out);
  } catch (e) {
    job.reject(e);
  } finally {
    busy = false;
    runningMeta = null;
    void drainQueue();
  }
}
