/**
 * 운영 SSE 스트림별 사용자 취소(명시적) — 브라우저 탭을 닫아 연결이 끊겨도 에이전트는 계속 돌게 하기 위해
 * res.close 로는 abort 하지 않고, POST /api/ops/cursor-agent-stream/cancel 만 이 컨트롤러를 abort 한다.
 */

/** @type {Map<string, AbortController>} */
const byRunId = new Map();

/**
 * @param {string} runId
 * @param {AbortController} ac
 */
export function registerOpsStreamUserCancel(runId, ac) {
  byRunId.set(runId, ac);
}

/**
 * @param {string} runId
 */
export function unregisterOpsStreamUserCancel(runId) {
  byRunId.delete(runId);
}

/**
 * @param {string} runId
 */
export function triggerOpsStreamUserCancel(runId) {
  const ac = byRunId.get(runId);
  if (ac) {
    try {
      ac.abort();
    } catch {
      /* ignore */
    }
  }
}
