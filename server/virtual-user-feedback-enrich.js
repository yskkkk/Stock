/**
 * 가상 사용자 피드백 — 불편함·개선·프롬프트 서사 보강 (기존 항목 포함)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listCodeVersionsSync } from "./code-version-store.js";
import {
  readVirtualUserStoreSync,
  writeVirtualUserStoreSync,
} from "./virtual-user-store.js";
import { buildVirtualFeedbackPrompt } from "./virtual-user-runner.js";

/**
 * @param {import("./virtual-user-store.js").VirtualFeedback} item
 * @param {import("./virtual-user-store.js").VirtualPersona | undefined} persona
 * @param {string} discomfort
 */
function rebuildPromptFallback(item, persona, discomfort) {
  if (persona) {
    return buildVirtualFeedbackPrompt(
      item.id,
      persona,
      {
        severity: item.severity || "minor",
        area: item.area || "navigation",
        title: item.title || "UI 불편",
        detail: discomfort,
        suggestion:
          String(item.suggestion || "").trim() ||
          "기존 UI 패턴 안에서 최소 diff로 고친다. PC·모바일·아이콘 크기를 함께 확인한다.",
      },
      item.sessionId || "legacy",
    );
  }
  const sat = 3;
  return [
    "# 가상 사용자 피드백 구현 요청",
    "",
    "당신은 Stock 앱(React+Vite+Express) 코딩 에이전트다. 아래 UX 피드백을 **최소 diff**로 반영하라.",
    "관련 없는 리팩터·좌측 열 레이아웃 변경 금지. 실주문/돈이 나가는 동작은 추가하지 말 것. 끝나면 git commit 후 git push.",
    "UI는 **PC와 모바일을 항상 함께** 맞춘다. 아이콘·터치 크기까지 깐깐히 본다.",
    "",
    "## 메타",
    `- feedbackId: ${item.id}`,
    `- sessionId: ${item.sessionId || "legacy"}`,
    `- persona: ${item.personaName || "?"} (${item.personaId || "?"})`,
    `- satisfaction: ${sat}`,
    `- severity: ${item.severity}`,
    `- area: ${item.area}`,
    "",
    "## 불편함 (사용자 관찰)",
    discomfort,
    "",
    "## 기대 결과 / 제안",
    String(item.suggestion || "(제안 없음)"),
    "",
    "## 구현 체크",
    "- [ ] 문제 재현 경로를 코드에서 확인했다",
    "- [ ] UI/카피/동작 중 필요한 것만 고쳤다",
    "- [ ] PC와 모바일을 동시에 맞췄다",
    "- [ ] 아이콘·터치 크기를 PC·모바일에서 확인했다",
    "- [ ] 실주문·출금 등 돈이 나가는 경로를 늘리지 않았다",
    "- [ ] 커밋·푸시까지 완료했다",
  ].join("\n");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTIVITY_LOG = path.join(__dirname, ".logs", "record-mode-activity.log");

/**
 * @param {{ title?: string; detail?: string; discomfort?: string }} item
 */
export function buildDiscomfortText(item) {
  const existing = String(item.discomfort ?? "").trim();
  if (existing) return existing;
  const title = String(item.title ?? "").trim();
  const detail = String(item.detail ?? "").trim();
  if (title && detail) {
    if (detail.startsWith(title) || detail.includes(title)) return detail;
    return `${title}\n\n${detail}`;
  }
  return title || detail || "(불편함 미기록)";
}

/**
 * @param {string} agentText
 * @param {{ title?: string; suggestion?: string }} item
 */
export function buildImprovementSummary(agentText, item) {
  const raw = String(agentText ?? "").trim();
  if (raw) {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^```/.test(l));
    const pick = lines.slice(0, 8).join("\n").slice(0, 900);
    if (pick) return pick;
  }
  const suggestion = String(item.suggestion ?? "").trim();
  if (suggestion) return `반영 완료(요약): ${suggestion}`;
  const title = String(item.title ?? "").trim();
  return title ? `반영 완료: ${title}` : "에이전트 구현이 완료되었습니다.";
}

/**
 * @param {string} jobId
 * @returns {string | null}
 */
function findActivityMessageForJob(jobId) {
  if (!jobId || !fs.existsSync(ACTIVITY_LOG)) return null;
  try {
    const raw = fs.readFileSync(ACTIVITY_LOG, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const row = JSON.parse(lines[i]);
        if (row?.id === jobId && row.event === "ok" && row.message) {
          return String(row.message);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* optional */
  }
  return null;
}

/**
 * 기존·신규 피드백에 불편함/개선·버전/프롬프트를 채운다.
 * 항목마다 파일 쓰지 않고 한 번에 저장한다.
 * @returns {{ ok: true; updated: number; total: number }}
 */
export function enrichVirtualFeedbackNarrativesSync() {
  const store = readVirtualUserStoreSync();
  const versions = listCodeVersionsSync();
  const personasById = new Map(store.personas.map((p) => [p.id, p]));
  let updated = 0;
  /** @type {typeof store.feedback} */
  const nextFeedback = [];

  for (const item of store.feedback) {
    /** @type {Record<string, unknown>} */
    const patch = {};

    const discomfort = buildDiscomfortText(item);
    if (discomfort !== String(item.discomfort ?? "").trim()) {
      patch.discomfort = discomfort;
    } else if (!String(item.discomfort ?? "").trim()) {
      patch.discomfort = discomfort;
    }

    if (!item.preVersionId) {
      const pre = versions.find(
        (v) => v.feedbackId === item.id && v.kind === "pre-feedback",
      );
      if (pre) patch.preVersionId = pre.id;
    }

    if (!item.postVersionId) {
      const post = versions.find(
        (v) =>
          v.kind === "post-agent" &&
          (v.feedbackId === item.id ||
            (item.implementJobId && v.jobId === item.implementJobId)),
      );
      if (post) patch.postVersionId = post.id;
    }

    const promptEmpty =
      !String(item.prompt ?? "").trim() ||
      String(item.prompt).trim() === "(생성 중)";
    if (promptEmpty) {
      const persona = personasById.get(item.personaId);
      patch.prompt = rebuildPromptFallback(
        item,
        persona,
        String(patch.discomfort ?? discomfort),
      );
    }

    if (item.status === "done") {
      const hasImp = String(item.improvementSummary ?? "").trim();
      if (!hasImp) {
        // 목록 API를 막지 않도록 활동 로그 전체 스캔은 생략 (이미 implementResult 있으면 사용)
        const fromResult = String(item.implementResult ?? "").trim();
        patch.improvementSummary = buildImprovementSummary(fromResult, item);
      }
      if (item.implementDoneAtMs == null && item.implementQueuedAtMs != null) {
        const post = versions.find(
          (v) =>
            v.kind === "post-agent" &&
            (v.feedbackId === item.id ||
              (item.implementJobId && v.jobId === item.implementJobId)),
        );
        if (post?.createdAtMs) patch.implementDoneAtMs = post.createdAtMs;
      }
    }

    if (item.status === "queued") {
      const hasImp = String(item.improvementSummary ?? "").trim();
      if (!hasImp || hasImp.startsWith("구현 대기") || hasImp.startsWith("개발 대기")) {
        patch.improvementSummary =
          "에이전트 실행 중 — 완료되면 대기열의 다음 피드백을 전송합니다.";
      }
    }

    if (item.status === "new") {
      const hasImp = String(item.improvementSummary ?? "").trim();
      if (!hasImp) {
        patch.improvementSummary =
          "개발 대기열에 쌓임(FIFO). 앞선 건이 끝나면 에이전트로 전송됩니다.";
      }
    }

    if (Object.keys(patch).length === 0) {
      nextFeedback.push(item);
      continue;
    }
    nextFeedback.push({ ...item, ...patch });
    updated += 1;
  }

  if (updated > 0) {
    store.feedback = nextFeedback;
    writeVirtualUserStoreSync(store);
  }

  // silence unused in some builds
  void findActivityMessageForJob;

  return { ok: true, updated, total: store.feedback.length };
}
