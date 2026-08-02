import { describe, expect, it } from "vitest";
import { evaluateVirtualFeedbackSync } from "./virtual-user-manager.js";

describe("virtual-user-manager", () => {
  it("approves a solid feedback prompt", () => {
    const review = evaluateVirtualFeedbackSync({
      id: "t1",
      personaId: "vu-beginner-kr",
      personaName: "초보",
      sessionId: "s1",
      at: new Date().toISOString(),
      createdAtMs: Date.now(),
      status: "pending_review",
      severity: "minor",
      area: "account-manage",
      title: "계좌관리 비중 도넛에서 성장주 호버 숫자열이 안 맞음",
      detail:
        "계좌관리 탭에서 성장주 조각을 호버하면 포함 종목 금액·수익률·손익이 한 줄에 붙어 세로로 안 맞는다. 기존 버블 안에서 열만 정렬하면 된다.",
      suggestion:
        "기존 UI 패턴·골격 유지. 버블 리스트를 그리드로 맞춰 PC·모바일을 함께 본다.",
      discomfort: "숫자열이 들쑥날쑥해 읽기 어렵다",
      improvementSummary: "",
      implementResult: "",
      prompt: [
        "# 가상 사용자 피드백 구현 요청",
        "최소 diff",
        "## UI 방향 (운영자 의도 — 반드시 준수)",
        "## 불편함 (사용자 관찰)",
        "제목",
        "",
        "상세",
        "## 기대 결과 / 제안",
        "제안",
        "## 구현 체크",
        "- [ ] 확인",
        "x".repeat(350),
      ].join("\n"),
      implementJobId: null,
      implementQueuedAtMs: null,
      implementDoneAtMs: null,
      preVersionId: null,
      postVersionId: null,
      telegramSentAtMs: null,
      backupCount: 0,
      lastBackupId: null,
      managerScore: null,
      managerDecision: null,
      managerNotes: "",
      managerReviewedAtMs: null,
    });
    expect(review.score).toBeGreaterThanOrEqual(70);
    expect(["approve", "revise"]).toContain(review.decision);
  });

  it("rejects empty prompt", () => {
    const review = evaluateVirtualFeedbackSync({
      id: "t2",
      personaId: "vu-beginner-kr",
      personaName: "초보",
      sessionId: "s1",
      at: new Date().toISOString(),
      createdAtMs: Date.now(),
      status: "pending_review",
      severity: "nit",
      area: "x",
      title: "불편",
      detail: "짧음",
      suggestion: "",
      discomfort: "",
      improvementSummary: "",
      implementResult: "",
      prompt: "(생성 중)",
      implementJobId: null,
      implementQueuedAtMs: null,
      implementDoneAtMs: null,
      preVersionId: null,
      postVersionId: null,
      telegramSentAtMs: null,
      backupCount: 0,
      lastBackupId: null,
      managerScore: null,
      managerDecision: null,
      managerNotes: "",
      managerReviewedAtMs: null,
    });
    expect(review.decision).toBe("reject");
  });
});
