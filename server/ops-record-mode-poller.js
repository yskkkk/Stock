/**
 * 기록 모드: queue.json을 `RECORD_MODE_POLL_MS`(기본 30초)마다 읽어 pending을 실행.
 * 에이전트는 기존과 동일 워커로 직렬화하며, `enqueueOpsAgentJob` meta로 **운영 실행 큐 UI**와 이력 id를 맞춘다.
 */
import { runOpsCursorAgent } from "./cursor-ops-agent.js";
import { enqueueOpsAgentJob } from "./ops-agent-job-queue.js";
import { finalizeOpsAgentEntry, prependRunningOpsEntry } from "./ops-agent-history-store.js";
import {
  RECORD_MODE_POLL_MS,
  RECORD_MODE_REQUEST_IP,
  appendRecordModeActivityLog,
  claimNextPendingRecordJob,
  removeRecordModeQueueItem,
  revertRecordModeJobToPending,
  updateRecordModeItemStatus,
} from "./ops-record-mode-store.js";

let started = false;

/**
 * @param {string} id
 * @param {string} instruction
 */
async function runRecordModeAgentJob(id, instruction) {
  const rip = RECORD_MODE_REQUEST_IP;
  appendRecordModeActivityLog({ event: "start", id, instruction });
  await prependRunningOpsEntry(id, instruction, rip);
  try {
    const out = await runOpsCursorAgent({ instruction, requestIp: rip });
    const tail = String(out.result ?? "").trim();
    appendRecordModeActivityLog({
      event: "ok",
      id,
      instruction,
      message: tail.length > 0 ? tail : null,
    });
    await finalizeOpsAgentEntry(id, {
      state: "ok",
      instruction,
      requestIp: rip,
      phaseLine: "기록 모드 (비스트리밍)",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      streamText: "",
      statusText: String(out.status ?? "finished"),
      resultText: out.result ?? "",
      durationMs:
        typeof out.durationMs === "number" && Number.isFinite(out.durationMs)
          ? out.durationMs
          : null,
      runtimeLabel: typeof out.runtime === "string" ? out.runtime : "local",
      error: null,
    });
    await updateRecordModeItemStatus(id, "done", null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendRecordModeActivityLog({ event: "error", id, instruction, message: msg });
    await finalizeOpsAgentEntry(id, {
      state: "error",
      instruction,
      requestIp: rip,
      phaseLine: "",
      cursorLine: "",
      thinkingLine: "",
      toolLine: "",
      streamText: "",
      statusText: null,
      resultText: null,
      durationMs: null,
      runtimeLabel: null,
      error: msg,
    });
    await removeRecordModeQueueItem(id);
  } finally {
    /** 다음 `pending`을 폴링 주기를 기다리지 않고 바로 집어감 */
    setImmediate(() => {
      void tickRecordModePoller();
    });
  }
}

async function tickRecordModePoller() {
  const apiKey = String(process.env.CURSOR_API_KEY ?? "").trim();
  if (!apiKey) return;

  const claimed = await claimNextPendingRecordJob();
  if (!claimed) return;

  try {
    await enqueueOpsAgentJob(
      () => runRecordModeAgentJob(claimed.id, claimed.instruction),
      undefined,
      {
        historyRunId: claimed.id,
        requestIp: RECORD_MODE_REQUEST_IP,
        instruction: claimed.instruction,
      },
    );
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e
        ? String(/** @type {{ code?: string }} */ (e).code)
        : "";
    if (code === "OPS_QUEUE_FULL") {
      await revertRecordModeJobToPending(claimed.id);
      return;
    }
    await revertRecordModeJobToPending(claimed.id);
  }
}

export function startOpsRecordModePoller() {
  if (started) return;
  started = true;
  setInterval(() => {
    void tickRecordModePoller();
  }, RECORD_MODE_POLL_MS);
  setTimeout(() => {
    void tickRecordModePoller();
  }, 3000);
}
