/**
 * VU 게이트
 * - 구현(implement): 웹/기록모드 에이전트가 돌 때만 busy (IDE lease는 막지 않음)
 * - 탐색(explore): IDE 요청이 큐에 있으면 쉬고, 개발 완료 후 재개
 */
import {
  getOpsAgentQueueMemorySnapshot,
  isOpsAgentJobRunning,
} from "./ops-agent-job-queue.js";

function isIdeQueueEntry(entry) {
  return (
    entry?.source === "ide" ||
    entry?.requestIp === "cursor-ide"
  );
}

/**
 * IDE(이 Cursor 채팅) 개발 요청이 실행·대기 중이면 true — 탐색은 이때만 쉼.
 */
export function isIdeDevBusySync() {
  try {
    const entries = getOpsAgentQueueMemorySnapshot()?.entries ?? [];
    return entries.some(
      (e) =>
        isIdeQueueEntry(e) &&
        (e.status === "running" || e.status === "waiting"),
    );
  } catch {
    return false;
  }
}

export function isServerDevelopingSync() {
  try {
    if (!isOpsAgentJobRunning()) return false;
    const entries = getOpsAgentQueueMemorySnapshot()?.entries ?? [];
    const runningEntry = entries.find((e) => e.status === "running");
    if (!runningEntry) return true;
    if (isIdeQueueEntry(runningEntry)) return false;
    return true;
  } catch {
    return false;
  }
}
