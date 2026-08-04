/**
 * 가상 사용자 피드백 → 에이전트 직렬 실행
 * - 피드백은 탐색 중·개발 중에도 계속 쌓임(status=new 대기열)
 * - 에이전트 전송만 FIFO 1건씩: 앞 건 완료 후 다음 new를 보냄
 */
import { appendRecordModePendingJob, readRecordModeQueueSync, removeDetachedRecordModeJobsSync } from "./ops-record-mode-store.js";
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
import { isServerDevelopingSync } from "./virtual-user-dev-gate.js";
import {
  hasCursorApiKey,
  pauseVirtualUserForApiExhaustion,
} from "./virtual-user-api-guard.js";
import { ensureManagerApprovedForImplementSync } from "./virtual-user-manager.js";

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
      status: f.managerDecision && f.managerDecision !== "reject"
        ? "approved"
        : "pending_review",
      implementJobId: null,
      implementQueuedAtMs: null,
      improvementSummary: "큐 유실 — 매니저 승인 상태로 복구 후 재전송 대기",
    });
    n += 1;
  }
  const linked = new Set(
    listVirtualFeedbackSync()
      .map((f) => f.implementJobId)
      .filter(Boolean),
  );
  const detached = removeDetachedRecordModeJobsSync(linked);
  if (detached > 0) {
    appendServerEventLog(
      "virtual-user",
      `reclaim detached record-mode jobs removed=${detached}`,
    );
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
  if (opts.force !== true && cfg.enabled === false) {
    return { ok: false, skipped: true, reason: "disabled" };
  }
  const autoOn = opts.force === true || cfg.autoImplement !== false;
  if (!autoOn) return { ok: false, skipped: true, reason: "auto-off" };

  // 피드백 프롬프트는 항상 매니저 검토 후 approved만 전송
  const gated = ensureManagerApprovedForImplementSync(item);
  if (!gated.ok || !gated.item) {
    return {
      ok: false,
      skipped: true,
      reason: gated.reason || "manager-gate",
    };
  }
  const approved = gated.item;

  if (!hasCursorApiKey()) {
    pauseVirtualUserForApiExhaustion(
      "CURSOR_API_KEY 없음 — 가상 사용자를 정지했습니다.",
    );
    return { ok: false, skipped: true, reason: "no-api-key" };
  }

  if (opts.force !== true && hasActiveVirtualUserImplementJobSync()) {
    return { ok: false, skipped: true, reason: "serial-busy" };
  }
  // IDE(이 채팅) lease는 막지 않음 — 웹/기록모드 에이전트만 busy
  if (opts.force !== true && isServerDevelopingSync()) {
    return { ok: false, skipped: true, reason: "server-developing" };
  }

  const minSev = String(cfg.autoImplementMinSeverity || "minor");
  if (!severityOk(approved.severity, minSev)) {
    return { ok: false, skipped: true, reason: "severity-gate" };
  }

  migrateBaselineToPreVirtualUserSync();
  ensureBaselineCodeVersionSync();

  const pre = createCodeVersionSync({
    label: `피드백 직전 · ${String(approved.title).slice(0, 40)}`,
    kind: "pre-feedback",
    feedbackId: approved.id,
    note: `persona=${approved.personaName}; severity=${approved.severity}; area=${approved.area}`,
    commitIfDirty: false,
  });

  const baseline = ensureBaselineCodeVersionSync();
  const promptBase = String(approved.prompt || "").trim();
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
      `auto-implement queue fail feedback=${approved.id} code=${queued.code || "?"}`,
    );
    return {
      ok: false,
      skipped: false,
      reason: queued.code || "queue-fail",
      preVersion: pre.ok ? pre.version : null,
    };
  }

  patchVirtualFeedbackSync(approved.id, {
    status: "queued",
    implementJobId: queued.id,
    implementQueuedAtMs: Date.now(),
    prompt: instruction,
    preVersionId: pre.ok && pre.version ? pre.version.id : null,
    improvementSummary: "에이전트 실행 중 — 완료되면 다음 피드백을 이어서 실행합니다.",
    discomfort:
      String(approved.discomfort || "").trim() ||
      [approved.title, approved.detail].filter(Boolean).join("\n\n"),
  });

  appendServerEventLog(
    "virtual-user",
    `auto-implement queued feedback=${approved.id} job=${queued.id}`,
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
    if (opts.force !== true && isServerDevelopingSync()) {
      return { ok: false, skipped: true, reason: "server-developing" };
    }
    if (opts.force !== true && hasActiveVirtualUserImplementJobSync()) {
      return { ok: false, skipped: true, reason: "serial-busy" };
    }

    const cfg = getVirtualUserContinuousSync();
    if (cfg.pausedByApiExhaustion && opts.force !== true) {
      return { ok: false, skipped: true, reason: "api-exhausted" };
    }
    // 마스터 off면 새 건만 막음(force 수동 구현은 허용). 진행 중 잡은 그대로 완료.
    if (opts.force !== true && cfg.enabled === false) {
      return { ok: false, skipped: true, reason: "disabled" };
    }
    if (opts.force !== true && cfg.autoImplement === false) {
      return { ok: false, skipped: true, reason: "auto-off" };
    }

    const minSev = String(cfg.autoImplementMinSeverity || "minor");
    // 매니저 승인(approved)만 에이전트 전송 — pending_review/new는 매니저 스캔이 먼저 처리
    const candidates = listVirtualFeedbackSync()
      .filter(
        (f) =>
          f.status === "approved" &&
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
