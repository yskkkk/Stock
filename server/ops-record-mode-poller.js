/**
 * 기록 모드: queue.json을 `RECORD_MODE_POLL_MS`(기본 30초)마다 읽어 pending을 실행.
 * 에이전트는 기존과 동일 워커로 직렬화하며, `enqueueOpsAgentJob` meta로 **운영 실행 큐 UI**와 id를 맞춘다.
 */
import { runOpsCursorAgent } from "./cursor-ops-agent.js";
import { enqueueOpsAgentJob } from "./ops-agent-job-queue.js";
import {
  RECORD_MODE_POLL_MS,
  RECORD_MODE_REQUEST_IP,
  appendRecordModeActivityLog,
  claimNextPendingRecordJob,
  removeRecordModeQueueItem,
  revertRecordModeJobToPending,
  updateRecordModeItemStatus,
} from "./ops-record-mode-store.js";
import { markPollerBootStarted } from "./poller-registry.js";
import { maybePauseVirtualUserFromAgentError } from "./virtual-user-api-guard.js";
import {
  getVirtualUserContinuousSync,
} from "./virtual-user-store.js";

let started = false;

/**
 * @param {string} id
 * @param {string} instruction
 */
async function runRecordModeAgentJob(id, instruction) {
  appendRecordModeActivityLog({ event: "start", id, instruction });
  try {
    const out = await runOpsCursorAgent({ instruction, requestIp: RECORD_MODE_REQUEST_IP });
    const tail = String(out.result ?? "").trim();
    appendRecordModeActivityLog({
      event: "ok",
      id,
      instruction,
      message: tail.length > 0 ? tail : null,
    });
    await updateRecordModeItemStatus(id, "done", null);
    try {
      const { createCodeVersionSync } = await import("./code-version-store.js");
      const { listVirtualFeedbackSync, patchVirtualFeedbackSync } = await import(
        "./virtual-user-store.js"
      );
      createCodeVersionSync({
        label: `에이전트 완료 · ${id.slice(0, 8)}`,
        kind: "post-agent",
        jobId: id,
        note: "record-mode agent finished",
      });
      const fb = listVirtualFeedbackSync().find((f) => f.implementJobId === id);
      if (fb) {
        patchVirtualFeedbackSync(fb.id, { status: "done" });
      }
    } catch {
      /* version bookkeeping optional */
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendRecordModeActivityLog({ event: "error", id, instruction, message: msg });
    maybePauseVirtualUserFromAgentError(e);
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

  const vu = getVirtualUserContinuousSync();
  if (vu.pausedByApiExhaustion) return;

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
  if (process.env.OPS_RECORD_MODE_DISABLED === "1") return;
  started = true;
  markPollerBootStarted("ops-record-mode");
  setInterval(() => {
    void tickRecordModePoller();
  }, RECORD_MODE_POLL_MS);
  setTimeout(() => {
    void tickRecordModePoller();
  }, 3000);
}
