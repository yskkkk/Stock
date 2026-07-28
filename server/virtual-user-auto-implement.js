/**
 * 가상 사용자 피드백 → 기록 모드 에이전트 자동 큐
 */
import { appendRecordModePendingJob } from "./ops-record-mode-store.js";
import {
  createCodeVersionSync,
  ensureBaselineCodeVersionSync,
  migrateBaselineToPreVirtualUserSync,
} from "./code-version-store.js";
import {
  getVirtualUserContinuousSync,
  patchVirtualFeedbackSync,
} from "./virtual-user-store.js";
import { appendServerEventLog } from "./access-log.js";
import {
  hasCursorApiKey,
  pauseVirtualUserForApiExhaustion,
} from "./virtual-user-api-guard.js";

const SEV_RANK = { blocker: 4, major: 3, minor: 2, nit: 1 };

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
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 * @param {{ force?: boolean }} [opts]
 */
export async function maybeAutoImplementVirtualFeedback(item, opts = {}) {
  if (!item?.id) return { ok: false, skipped: true, reason: "no-item" };
  if (item.status === "queued" || item.status === "done") {
    return { ok: false, skipped: true, reason: "already-handled" };
  }
  if (item.implementJobId) {
    return { ok: false, skipped: true, reason: "has-job" };
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
    improvementSummary:
      "구현 대기 중 — 아래 프롬프트로 에이전트 큐에 등록됨.",
    discomfort:
      String(item.discomfort || "").trim() ||
      [item.title, item.detail].filter(Boolean).join("\n\n"),
  });

  appendServerEventLog(
    "virtual-user",
    `auto-implement queued feedback=${item.id} job=${queued.id}`,
  );

  return {
    ok: true,
    skipped: false,
    jobId: queued.id,
    preVersion: pre.ok ? pre.version : null,
    baseline: baseline.version ?? null,
  };
}
