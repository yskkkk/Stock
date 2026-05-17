/**
 * Cursor 운영 에이전트는 동시에 여러 개 돌리면 git/워킹트리 충돌이 나기 쉬움.
 * 모든 SSE·비스트리밍 실행을 단일 워커 FIFO 큐로 직렬화한다.
 */

/** @typedef {{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }} QueuedJob */

const queue = /** @type {QueuedJob[]} */ ([]);
let busy = false;

/** 대기만 제한 (실행 중 1건은 별도). 과하면 503 */
const MAX_WAITING = 25;

export function getOpsAgentQueueWaitingCount() {
  return queue.length;
}

export function isOpsAgentJobRunning() {
  return busy;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {() => void} [onQueued] busy일 때 이번 요청이 대기열에만 들어간 직후(헤더·SSE를 먼저 열 때)
 * @returns {Promise<T>}
 */
export function enqueueOpsAgentJob(fn, onQueued) {
  if (queue.length >= MAX_WAITING) {
    const err = new Error(
      "운영 에이전트 대기열이 가득 찼습니다. 잠시 후 다시 시도하세요.",
    );
    err.code = "OPS_QUEUE_FULL";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const willWaitBehindRunningJob = busy;
    queue.push({ fn, resolve, reject });
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
  try {
    const out = await job.fn();
    job.resolve(out);
  } catch (e) {
    job.reject(e);
  } finally {
    busy = false;
    void drainQueue();
  }
}
