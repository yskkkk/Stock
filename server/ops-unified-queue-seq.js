/**
 * 에이전트 SSE·비스트리밍·기록 모드가 공유하는 단일 실행 큐(`ops-agent-job-queue`) 기준 순번.
 * UI에는 통합 큐를 따로 두지 않고, 각 카드에만 `unifiedQueueSeq`(1-based)를 붙인다.
 */
import { getOpsAgentQueueSnapshot } from "./ops-agent-job-queue.js";

/**
 * @param {Array<{
 *   id: string;
 *   instruction: string;
 *   status: string;
 *   createdAtMs: number;
 *   lockedAtMs?: number | null;
 *   updatedAtMs?: number | null;
 *   error?: string | null;
 * }>} recordItemsRaw
 * @returns {{
 *   agentEntries: Array<Record<string, unknown> & { unifiedQueueSeq: number }>;
 *   recordItems: Array<Record<string, unknown> & { unifiedQueueSeq: number | null }>;
 * }}
 */
/** @param {Array<Record<string, unknown>>} entries */
export function enrichAgentEntriesWithUnifiedSeq(entries) {
  return entries.map((e, i) => ({
    ...e,
    unifiedQueueSeq: i + 1,
  }));
}

export function enrichUnifiedQueueAgentAndRecord(recordItemsRaw) {
  const snap = getOpsAgentQueueSnapshot();
  const agentEntries = snap.entries.map((e, i) => ({
    ...e,
    unifiedQueueSeq: i + 1,
  }));

  const idToSeq = new Map(
    agentEntries.map((e) => [e.id, /** @type {number} */ (e.unifiedQueueSeq)]),
  );

  let next = agentEntries.length + 1;
  const recordItems = recordItemsRaw.map((it) => {
    const seq = idToSeq.get(it.id);
    if (typeof seq === "number") {
      return { ...it, unifiedQueueSeq: seq };
    }
    if (it.status === "pending" && it.instruction.trim().length > 0) {
      return { ...it, unifiedQueueSeq: next++ };
    }
    return { ...it, unifiedQueueSeq: null };
  });

  return { agentEntries, recordItems };
}
