/**
 * VU 구현 전송 게이트 — 웹/기록모드 에이전트가 돌 때만 busy.
 * IDE(이 Cursor 채팅) lease는 VU를 막지 않는다.
 */
import {
  getOpsAgentQueueMemorySnapshot,
  isOpsAgentJobRunning,
} from "./ops-agent-job-queue.js";

export function isServerDevelopingSync() {
  try {
    if (!isOpsAgentJobRunning()) return false;
    const entries = getOpsAgentQueueMemorySnapshot()?.entries ?? [];
    const runningEntry = entries.find((e) => e.status === "running");
    if (!runningEntry) return true;
    if (runningEntry.source === "ide" || runningEntry.requestIp === "cursor-ide") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
