/**
 * 가상 사용자 피드백 → 에이전트 직렬 실행
 * - 피드백은 탐색 중·개발 중에도 계속 쌓임(status=new 대기열)
 * - 에이전트 전송만 FIFO 1건씩: 앞 건 완료 후 다음 new를 보냄
 */
import { appendRecordModePendingJob, readRecordModeQueueSync } from "./ops-record-mode-store.js";
import {
  createCodeVersionSync,
  ensureBaselineCodeVersionSync,
  migrateBaselineToPreVirtualUserSync,
} from "./code-version-store.js";
import {
  getVirtualUserContinuousSync,
  listVirtualFeedbackSync,
  patchVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { appendServerEventLog } from "./access-log.js";
import { isOpsAgentJobRunning } from "./ops-agent-job-queue.js";
import {
  hasCursorApiKey,
  pauseVirtualUserForApiExhaustion,
} from "./virtual-user-api-guard.js";

const SEV_RANK = { blocker: 4, major: 3, minor: 2, nit: 1 };

/** @type {Promise<unknown> | null} */
let dispatchChain = null;

/**
 * @param {string} severity
 * @param {string} minSeverity
 */
function severityOk(severity, minSeverity) {
  const a = SEV_RANK[/** @type {keyof typeof SEV_RANK} */ (severity)] ?? 0;
  const b = SEV_RANK[/** @type {keyof typeof SEV_RANK} */ (minSeverity)] ?? 2;
  return a >= b;
}

/**
 * 가상 사용자 구현 잡이 record-mode에서 아직 pending/running인지
 */
export function hasActiveVirtualUserImplementJobSync() {
  const activeFb = listVirtualFeedbackSync().filter(
    (f) => f.status === "queued" && f.implementJobId,
  );
  if (!activeFb.length) return false;
  let queue;
  try {
    queue = readRecordModeQueueSync();
  } catch {
    return activeFb.length > 0;
  }
  const items = queue?.items || [];
  return activeFb.some((f) => {
    const job = items.find((it) => it.id === f.implementJobId);
    return job && (job.status === "pending" || job.status === "running");
  });
}

/**
 * queued인데 잡이 큐에 없으면 new로 되돌려 다시 집어갈 수 있게 함
 */
function reclaimOrphanQueuedFeedbackSync() {
  let queueItems = [];
  try {
    queueItems = readRecordModeQueueSync()?.items || [];
  } catch {
    return 0;
  }
  const ids = new Set(queueItems.map((it) => it.id));
  let n = 0;
  for (const f of listVirtualFeedbackSync()) {
    if (f.status !== "queued" || !f.implementJobId) continue;
    if (ids.has(f.implementJobId)) continue;
    patchVirtualFeedbackSync(f.id, {
      status: "new",
      implementJobId: null,
      implementQueuedAtMs: null,
      improvementSummary: "",
    });
    n += 1;
  }
  return n;
}

/**
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 * @param {{ force?: boolean }} [opts]
 */
export async function maybeAutoImplementVirtualFeedback(item, opts = {}) {
  if (!item?.id) return { ok: false, skipped: true, reason: "no-item" };
  if (item.status === "done") {
    return { ok: false, skipped: true, reason: "already-done" };
  }
  if (item.status === "queued" && item.implementJobId) {
    return { ok: false, skipped: true, reason: "already-queued" };
  }

  const cfg = getVirtualUserContinuousSync();
  if (cfg.pausedByApiExhaustion && opts.force !== true) {
    return { ok: false, skipped: true, reason: "api-exhausted" };
  }
  const autoOn = opts.force === true || cfg.autoImplement !== false;
  if (!autoOn) return { ok: false, skipped: true, reason: "auto-off" };

  if (!hasCursorApiKey()) {
    pauseVirtualUserForApiExhaustion(
      "CURSOR_API_KEY 없음 — 자동 구현을 정지했습니다.",
    );
    return { ok: false, skipped: true, reason: "no-api-key" };
  }

  if (opts.force !== true && hasActiveVirtualUserImplementJobSync()) {
    return { ok: false, skipped: true, reason: "serial-busy" };
  }
  if (opts.force !== true && isOpsAgentJobRunning()) {
    return { ok: false, skipped: true, reason: "server-developing" };
  }

  const minSev = String(cfg.autoImplementMinSeverity || "minor");
  if (!severityOk(item.severity, minSev)) {
    return { ok: false, skipped: true, reason: "severity-gate" };
  }

  migrateBaselineToPreVirtualUserSync();
  ensureBaselineCodeVersionSync();

  const pre = createCodeVersionSync({
    label: `피드백 직전 · ${String(item.title).slice(0, 40)}`,
    kind: "pre-feedback",
    feedbackId: item.id,
    note: `persona=${item.personaName}; severity=${item.severity}; area=${item.area}`,
    commitIfDirty: false,
  });

  const baseline = ensureBaselineCodeVersionSync();
  const promptBase = String(item.prompt || "").trim();
  if (!promptBase || promptBase === "(생성 중)") {
    return { ok: false, skipped: true, reason: "empty-prompt" };
  }

  const versionBlock = [
    "",
    "## 코드 버전 (롤백용)",
    `- baselineId: ${baseline.version?.id ?? "(없음)"}`,
    `- baselineSha: ${baseline.version?.commitShort ?? "?"}`,
    `- preVersionId: ${pre.ok && pre.version ? pre.version.id : "(없음)"}`,
    `- preSha: ${pre.ok && pre.version ? pre.version.commitShort : "?"}`,
    "- 작업 후 git commit + git push 필수.",
    "- 사용자가 관리자 UI에서 위 버전으로 롤백할 수 있다. force push·히스토리 재작성 금지.",
    "",
  ].join("\n");

  const instruction = `${promptBase}${versionBlock}`.slice(0, 14_000);

  const queued = await appendRecordModePendingJob(instruction);
  if (!queued.ok) {
    appendServerEventLog(
      "virtual-user",
      `auto-implement queue fail feedback=${item.id} code=${queued.code || "?"}`,
    );
    return {
      ok: false,
      skipped: false,
      reason: queued.code || "queue-fail",
      preVersion: pre.ok ? pre.version : null,
    };
  }

  patchVirtualFeedbackSync(item.id, {
    status: "queued",
    implementJobId: queued.id,
    implementQueuedAtMs: Date.now(),
    prompt: instruction,
    preVersionId: pre.ok && pre.version ? pre.version.id : null,
    improvementSummary: "에이전트 실행 중 — 완료되면 다음 피드백을 이어서 실행합니다.",
    discomfort:
      String(item.discomfort || "").trim() ||
      [item.title, item.detail].filter(Boolean).join("\n\n"),
  });

  appendServerEventLog(
    "virtual-user",
    `auto-implement queued feedback=${item.id} job=${queued.id}`,
  );

  try {
    const { kickOpsRecordModePoller } = await import("./ops-record-mode-poller.js");
    kickOpsRecordModePoller();
  } catch {
    /* poller kick optional */
  }

  return {
    ok: true,
    jobId: queued.id,
    preVersion: pre.ok ? pre.version : null,
  };
}

/**
 * 대기 중인 new 피드백 중 가장 오래된 1건만 에이전트로 보냄
 * @param {{ force?: boolean }} [opts]
 */
export async function dispatchNextVirtualUserImplement(opts = {}) {
  const run = async () => {
    reclaimOrphanQueuedFeedbackSync();
    if (opts.force !== true && isOpsAgentJobRunning()) {
      return { ok: false, skipped: true, reason: "server-developing" };
    }
    if (opts.force !== true && hasActiveVirtualUserImplementJobSync()) {
      return { ok: false, skipped: true, reason: "serial-busy" };
    }

    const cfg = getVirtualUserContinuousSync();
    if (cfg.pausedByApiExhaustion && opts.force !== true) {
      return { ok: false, skipped: true, reason: "api-exhausted" };
    }
    if (opts.force !== true && cfg.autoImplement === false) {
      return { ok: false, skipped: true, reason: "auto-off" };
    }

    const minSev = String(cfg.autoImplementMinSeverity || "minor");
    const candidates = listVirtualFeedbackSync()
      .filter(
        (f) =>
          f.status === "new" &&
          severityOk(f.severity, minSev) &&
          String(f.prompt || "").trim() &&
          String(f.prompt).trim() !== "(생성 중)",
      )
      .sort((a, b) => a.createdAtMs - b.createdAtMs);

    for (const item of candidates) {
      const r = await maybeAutoImplementVirtualFeedback(item, opts);
      if (r.ok) {
        appendServerEventLog(
          "virtual-user",
          `dispatch next implement feedback=${item.id}`,
        );
        return r;
      }
      if (r.reason === "serial-busy" || r.reason === "api-exhausted") {
        return r;
      }
    }
    return { ok: false, skipped: true, reason: "none" };
  };

  const prev = dispatchChain || Promise.resolve();
  const next = prev.then(run, run);
  dispatchChain = next.then(
    () => null,
    () => null,
  );
  return next;
}
