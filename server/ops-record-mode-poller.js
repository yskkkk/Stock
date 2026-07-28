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
/** @type {Promise<unknown> | null} */
let tickInflight = null;

function logRecordModeTickError(e) {
  console.warn(
    "[ops-record-mode] tick:",
    e instanceof Error ? e.message : e,
  );
}

/**
 * pending이 있으면 즉시 한 건 집어 실행 (폴링 주기 대기 없음)
 */
export function kickOpsRecordModePoller() {
  setImmediate(() => {
    void tickRecordModePoller().catch(logRecordModeTickError);
  });
}

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
      const {
        buildImprovementSummary,
        buildDiscomfortText,
      } = await import("./virtual-user-feedback-enrich.js");
      const fb = listVirtualFeedbackSync().find((f) => f.implementJobId === id);
      const post = createCodeVersionSync({
        label: fb
          ? `에이전트 완료 · ${String(fb.title).slice(0, 36)}`
          : `에이전트 완료 · ${id.slice(0, 8)}`,
        kind: "post-agent",
        jobId: id,
        feedbackId: fb?.id ?? null,
        note: tail.slice(0, 240) || "record-mode agent finished",
      });
      if (fb) {
        patchVirtualFeedbackSync(fb.id, {
          status: "done",
          implementDoneAtMs: Date.now(),
          implementResult: tail.slice(0, 4_000),
          improvementSummary: buildImprovementSummary(tail, fb),
          discomfort: buildDiscomfortText(fb),
          postVersionId: post.ok && post.version ? post.version.id : null,
        });
        try {
          const { dispatchNextVirtualUserImplement } = await import(
            "./virtual-user-auto-implement.js"
          );
          await dispatchNextVirtualUserImplement();
        } catch {
          /* next implement optional */
        }
      }
    } catch {
      /* version bookkeeping optional */
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendRecordModeActivityLog({ event: "error", id, instruction, message: msg });
    maybePauseVirtualUserFromAgentError(e);
    await removeRecordModeQueueItem(id);
    try {
      const { listVirtualFeedbackSync, patchVirtualFeedbackSync } = await import(
        "./virtual-user-store.js"
      );
      const fb = listVirtualFeedbackSync().find((f) => f.implementJobId === id);
      if (fb) {
        patchVirtualFeedbackSync(fb.id, {
          status: "new",
          implementJobId: null,
          implementQueuedAtMs: null,
          improvementSummary: `에이전트 실패 후 재시도 대기: ${msg.slice(0, 200)}`,
        });
      }
      const { dispatchNextVirtualUserImplement } = await import(
        "./virtual-user-auto-implement.js"
      );
      await dispatchNextVirtualUserImplement();
    } catch {
      /* optional */
    }
  } finally {
    /** 다음 `pending`을 폴링 주기를 기다리지 않고 바로 집어감 */
    kickOpsRecordModePoller();
  }
}

async function tickRecordModePoller() {
  if (tickInflight) return tickInflight;
  tickInflight = (async () => {
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
  })().finally(() => {
    tickInflight = null;
  });
  return tickInflight;
}

export function startOpsRecordModePoller() {
  if (started) return;
  if (process.env.OPS_RECORD_MODE_DISABLED === "1") return;
  started = true;
  markPollerBootStarted("ops-record-mode");
  setInterval(() => {
    void tickRecordModePoller().catch(logRecordModeTickError);
  }, RECORD_MODE_POLL_MS);
  setTimeout(() => {
    void tickRecordModePoller().catch(logRecordModeTickError);
  }, 3000);
}
