/**
 * 가상 사용자 매니저 — 산출물(피드백·프롬프트) 평가·수정·승인
 * 에이전트 전송 전 필수 게이트. LLM 없이 규칙 기반으로 품질을 올리고
 * 페르소나 개선 메모를 traits에 반영한다.
 */
import { appendServerEventLog } from "./access-log.js";
import { vuUiDirectionSuggestionGuard } from "../shared/virtual-user-ui-direction.js";
import {
  getVirtualFeedbackByIdSync,
  listVirtualFeedbackSync,
  patchVirtualFeedbackSync,
  updateVirtualPersonaSync,
  getVirtualUserContinuousSync,
  patchVirtualUserContinuousSync,
  readVirtualUserStoreSync,
} from "./virtual-user-store.js";

/**
 * @typedef {{
 *   score: number;
 *   decision: "approve"|"revise"|"reject";
 *   notes: string[];
 *   revisedTitle?: string;
 *   revisedDetail?: string;
 *   revisedSuggestion?: string;
 *   revisedSeverity?: "blocker"|"major"|"minor"|"nit";
 *   revisedPrompt?: string;
 *   personaTweaks?: { traitsAppend?: string };
 * }} ManagerReviewResult
 */

/**
 * @param {string} text
 */
function hasHangul(text) {
  return /[\uAC00-\uD7A3]/.test(String(text || ""));
}

/**
 * @param {string} text
 */
function tooVague(text) {
  const t = String(text || "").trim();
  if (t.length < 18) return true;
  if (/^(개선|불편|버그|이상|이상함|고쳐|수정)\.?$/i.test(t)) return true;
  if (/^(뭔가|좀|그냥|대충)/.test(t) && t.length < 40) return true;
  return false;
}

/**
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 * @returns {ManagerReviewResult}
 */
export function evaluateVirtualFeedbackSync(item) {
  /** @type {string[]} */
  const notes = [];
  let score = 70;
  let decision = /** @type {ManagerReviewResult["decision"]} */ ("approve");

  const title = String(item.title || "").trim();
  const detail = String(item.detail || "").trim();
  const suggestion = String(item.suggestion || "").trim();
  const prompt = String(item.prompt || "").trim();
  const area = String(item.area || "").trim();
  const severity = String(item.severity || "minor");

  if (!title) {
    score -= 30;
    notes.push("제목이 비어 있음");
  } else if (tooVague(title)) {
    score -= 12;
    notes.push("제목이 모호함 — 구체적 화면·동작을 명시하도록 보강");
  }

  if (!detail || detail.length < 40) {
    score -= 18;
    notes.push("상세 설명이 짧음 — 재현 경로·기대 동작을 보강");
  } else if (tooVague(detail)) {
    score -= 10;
    notes.push("상세가 모호함");
  }

  if (!hasHangul(title) && !hasHangul(detail)) {
    score -= 8;
    notes.push("한글 설명이 부족함");
  }

  if (!suggestion || suggestion.length < 20) {
    score -= 10;
    notes.push("제안이 빈약함 — 최소 diff 방향의 기대 결과 보강");
  }

  if (!area) {
    score -= 6;
    notes.push("area 미지정");
  }

  if (!prompt || prompt === "(생성 중)") {
    score -= 40;
    notes.push("구현 프롬프트가 아직 생성되지 않음");
  } else {
    if (!prompt.includes("최소 diff")) {
      score -= 6;
      notes.push("프롬프트에 최소 diff 지침 보강");
    }
    if (!prompt.includes("UI 방향")) {
      score -= 8;
      notes.push("UI 방향 SSOT 블록 누락 — 재작성");
    }
    if (
      !/PC.*모바일|모바일.*PC|넓은 뷰|좁은 폭/.test(prompt) ||
      !prompt.includes("동시에")
    ) {
      score -= 10;
      notes.push("PC·모바일 동시 검증 지침 부족 — 보강");
    }
    if (!/아이콘|터치|44/.test(prompt)) {
      score -= 8;
      notes.push("아이콘·터치 크기 점검 지침 부족 — 보강");
    }
    if (prompt.length < 400) {
      score -= 10;
      notes.push("프롬프트가 너무 짧음");
    }
    if (/force push|히스토리 재작성|--no-verify/i.test(prompt)) {
      score -= 20;
      notes.push("위험한 git 지시 포함 — 제거");
    }
  }

  const uiArea =
    /navigation|mobile|account-manage|rebalance|stock-vault|탐색|아이콘/.test(
      `${area}\n${title}\n${detail}`,
    );
  if (uiArea) {
    const blob = `${title}\n${detail}\n${suggestion}`;
    if (!/PC|모바|desktop|mobile|뷰포트|좁은|넓은/.test(blob)) {
      score -= 8;
      notes.push("UI 피드백에 PC·모바일 관점 명시 부족");
    }
  }

  let revisedSeverity = severity;
  if (
    /돈|출금|실주문|매수 실행|결제/.test(`${title}\n${detail}`) &&
    (severity === "nit" || severity === "minor")
  ) {
    revisedSeverity = "major";
    notes.push("금전 관련 → severity major로 상향");
    score -= 4;
  }
  if (
    /오타|여백|색|간격|문구/.test(`${title}\n${detail}`) &&
    severity === "blocker"
  ) {
    revisedSeverity = "minor";
    notes.push("시각/카피성 → severity minor로 하향");
  }

  /** @type {string | undefined} */
  let revisedTitle;
  /** @type {string | undefined} */
  let revisedDetail;
  /** @type {string | undefined} */
  let revisedSuggestion;

  if (tooVague(title) && detail.length > 20) {
    revisedTitle = detail.slice(0, 80).replace(/\s+/g, " ").trim();
    notes.push(`제목 재작성: ${revisedTitle.slice(0, 40)}…`);
  }

  if (detail.length < 40 && title) {
    revisedDetail = [
      title,
      "",
      "재현: 해당 화면에서 동일 경로를 다시 밟아 확인한다.",
      "기대: 기존 UI 패턴 안에서 마찰만 줄인다(골격·좌측 열 변경 금지).",
    ].join("\n");
    notes.push("상세 설명을 재현·기대 형식으로 보강");
  }

  if (!suggestion || suggestion.length < 20) {
    revisedSuggestion = vuUiDirectionSuggestionGuard(
      "해당 화면 컴포넌트만 최소 diff로 고치고, PC·모바일을 함께 검증한다.",
    );
    notes.push("제안 문장 보강");
  } else {
    const guarded = vuUiDirectionSuggestionGuard(suggestion);
    if (guarded !== suggestion) {
      revisedSuggestion = guarded;
      notes.push("제안에 UI 방향 가드 적용");
    }
  }

  /** @type {{ traitsAppend?: string } | undefined} */
  let personaTweaks;
  if (score < 55) {
    personaTweaks = {
      traitsAppend:
        " 매니저 피드백: 관찰은 ‘어디·무엇을·왜’를 한 문장에 넣고, PC·모바일·아이콘/터치 크기까지 명시한다. 제안은 기존 패턴 최소 수정으로 적을 것.",
    };
    notes.push("페르소나 traits에 구체성 지침 추가");
  }

  if (score < 40 || !prompt || prompt === "(생성 중)") {
    decision = "reject";
    notes.push("품질 미달 — 기각(dismissed)");
  } else if (
    score < 78 ||
    revisedTitle ||
    revisedDetail ||
    revisedSuggestion ||
    revisedSeverity !== severity
  ) {
    decision = "revise";
    notes.push("수정 후 승인");
  } else {
    decision = "approve";
    if (!notes.length) notes.push("품질 양호 — 승인");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    decision,
    notes,
    revisedTitle,
    revisedDetail,
    revisedSuggestion,
    revisedSeverity:
      revisedSeverity !== severity
        ? /** @type {"blocker"|"major"|"minor"|"nit"} */ (revisedSeverity)
        : undefined,
    personaTweaks,
  };
}

/**
 * @param {string} prompt
 * @param {ManagerReviewResult} review
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 */
function applyPromptRevisions(prompt, review, item) {
  let next = String(prompt || "");
  const title = review.revisedTitle || item.title;
  const detail = review.revisedDetail || item.detail;
  const suggestion = review.revisedSuggestion || item.suggestion;

  next = next.replace(
    /(## 불편함 \(사용자 관찰\)\n)([\s\S]*?)(\n## 기대 결과)/,
    `$1${title}\n\n${detail}\n$3`,
  );
  next = next.replace(
    /(## 기대 결과 \/ 제안\n)([\s\S]*?)(\n## 구현 체크)/,
    `$1${suggestion}\n$3`,
  );
  if (review.revisedSeverity) {
    next = next.replace(
      /- severity: \w+/,
      `- severity: ${review.revisedSeverity}`,
    );
  }
  if (!next.includes("## UI 방향")) {
    next = `${next}\n\n(매니저) UI 방향 SSOT·최소 diff·PC/모바일 동시 검증을 준수할 것.\n`;
  }
  const stamp = [
    "",
    "## 매니저 검토",
    `- score: ${review.score}`,
    `- decision: ${review.decision}`,
    ...review.notes.map((n) => `- ${n}`),
    "",
  ].join("\n");
  if (!next.includes("## 매니저 검토")) {
    next = `${next.trimEnd()}\n${stamp}`;
  } else {
    next = next.replace(/## 매니저 검토[\s\S]*$/m, stamp.trimStart());
  }
  return next.slice(0, 12_000);
}

/**
 * @param {string} feedbackId
 * @param {{ force?: boolean }} [opts]
 */
export function reviewVirtualFeedbackByIdSync(feedbackId, opts = {}) {
  const item = getVirtualFeedbackByIdSync(feedbackId);
  if (!item) return { ok: false, error: "피드백 없음" };

  if (
    opts.force !== true &&
    (item.status === "queued" || item.status === "done")
  ) {
    return { ok: false, skipped: true, reason: "terminal-status", item };
  }
  if (opts.force !== true && item.status === "dismissed") {
    return { ok: false, skipped: true, reason: "dismissed", item };
  }

  const review = evaluateVirtualFeedbackSync(item);
  const now = Date.now();

  /** @type {Record<string, unknown>} */
  const patch = {
    managerScore: review.score,
    managerDecision: review.decision,
    managerNotes: review.notes.join(" · ").slice(0, 1200),
    managerReviewedAtMs: now,
    improvementSummary:
      `매니저 검토: ${review.decision} (score ${review.score}) — ${review.notes.slice(0, 3).join("; ")}`.slice(
        0,
        800,
      ),
  };

  if (review.revisedTitle) patch.title = review.revisedTitle;
  if (review.revisedDetail) patch.detail = review.revisedDetail;
  if (review.revisedSuggestion) patch.suggestion = review.revisedSuggestion;
  if (review.revisedSeverity) patch.severity = review.revisedSeverity;

  const nextPrompt = applyPromptRevisions(String(item.prompt || ""), review, {
    ...item,
    title: /** @type {string} */ (patch.title ?? item.title),
    detail: /** @type {string} */ (patch.detail ?? item.detail),
    suggestion: /** @type {string} */ (patch.suggestion ?? item.suggestion),
  });
  patch.prompt = nextPrompt;
  review.revisedPrompt = nextPrompt;

  if (review.decision === "reject") {
    patch.status = "dismissed";
  } else {
    patch.status = "approved";
  }

  const patched = patchVirtualFeedbackSync(feedbackId, patch);

  if (review.personaTweaks?.traitsAppend && item.personaId) {
    try {
      const store = readVirtualUserStoreSync();
      const persona = store.personas.find((p) => p.id === item.personaId);
      if (persona) {
        const append = review.personaTweaks.traitsAppend;
        const traits = String(persona.traits || "");
        if (!traits.includes("매니저 피드백:")) {
          updateVirtualPersonaSync(persona.id, {
            traits: `${traits}${append}`.slice(0, 400),
          });
        }
      }
    } catch {
      /* optional */
    }
  }

  try {
    const cfg = getVirtualUserContinuousSync();
    patchVirtualUserContinuousSync({
      lastManagerAtMs: now,
      lastManagerDecision: review.decision,
      lastManagerScore: review.score,
      managerReviewCount:
        Math.max(0, Number(cfg.managerReviewCount) || 0) + 1,
    });
  } catch {
    /* optional */
  }

  appendServerEventLog(
    "virtual-user-manager",
    `review feedback=${feedbackId} decision=${review.decision} score=${review.score}`,
  );

  return {
    ok: true,
    review,
    item: patched.ok ? patched.item : getVirtualFeedbackByIdSync(feedbackId),
  };
}

/**
 * pending_review · legacy new(프롬프트 준비됨) 중 오래된 것부터 N건 검토
 * @param {{ limit?: number }} [opts]
 */
export function reviewPendingVirtualFeedbackBatchSync(opts = {}) {
  const limit = Math.min(20, Math.max(1, Number(opts.limit) || 5));
  const candidates = listVirtualFeedbackSync()
    .filter((f) => {
      const prompt = String(f.prompt || "").trim();
      if (!prompt || prompt === "(생성 중)") return false;
      return f.status === "pending_review" || f.status === "new";
    })
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(0, limit);

  /** @type {Array<{ id: string; decision: string; score: number }>} */
  const results = [];
  for (const f of candidates) {
    const r = reviewVirtualFeedbackByIdSync(f.id);
    if (r.ok && r.review) {
      results.push({
        id: f.id,
        decision: r.review.decision,
        score: r.review.score,
      });
    }
  }
  return { ok: true, reviewed: results.length, results };
}

/**
 * 에이전트 전송 직전 — 미검토면 즉시 검토. approved만 통과.
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 */
export function ensureManagerApprovedForImplementSync(item) {
  if (!item?.id) {
    return { ok: false, reason: "no-item", item: null };
  }
  if (item.status === "approved") {
    return { ok: true, item };
  }
  if (item.status === "dismissed") {
    return { ok: false, reason: "dismissed", item };
  }
  if (item.status === "queued" || item.status === "done") {
    return { ok: false, reason: "terminal-status", item };
  }
  const r = reviewVirtualFeedbackByIdSync(item.id);
  const next = r.item || getVirtualFeedbackByIdSync(item.id);
  if (!next || next.status !== "approved") {
    return {
      ok: false,
      reason: next?.status === "dismissed" ? "rejected" : "not-approved",
      item: next,
      review: r.review,
    };
  }
  return { ok: true, item: next, review: r.review };
}
