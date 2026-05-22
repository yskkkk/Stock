/**
 * 웹 에이전트 텔레그램 알림 본문 — 결과 + Git 반영 + 도구 로그
 */

const BODY_MAX = 3800;

/**
 * @param {{
 *   state: "ok" | "error" | "cancelled";
 *   capture: {
 *     resultText?: string | null;
 *     streamText?: string;
 *     toolLog?: string;
 *     runtimeLabel?: string | null;
 *     durationMs?: number | null;
 *     gitSummary?: string;
 *   };
 *   errorText?: string | null;
 * }} input
 */
export function buildOpsAgentTelegramBody(input) {
  const { state, capture, errorText } = input;
  const parts = [];

  if (state === "ok") {
    const result = String(capture.resultText ?? "").trim() || "(요약 없음)";
    parts.push(`【결과】\n${result}`);
  } else if (state === "cancelled") {
    parts.push("【결과】\n사용자가 요청을 중단했습니다.");
  } else {
    const err =
      String(errorText ?? capture.resultText ?? "").trim() || "알 수 없는 오류";
    parts.push(`【결과】\n${err}`);
  }

  const git = String(capture.gitSummary ?? "").trim();
  if (git) {
    parts.push(`【반영 요약】\n${git}`);
  }

  const meta = [];
  if (capture.runtimeLabel) meta.push(`실행: ${capture.runtimeLabel}`);
  if (capture.durationMs != null && Number.isFinite(capture.durationMs)) {
    meta.push(`소요: ${Math.round(capture.durationMs / 1000)}초`);
  }
  if (meta.length) parts.push(`【실행 정보】\n${meta.join("\n")}`);

  const tools = String(capture.toolLog ?? "").trim();
  if (tools) {
    const tail = tools.length > 1400 ? tools.slice(-1400) : tools;
    parts.push(`【도구 사용】\n${tail}`);
  }

  let body = parts.join("\n\n");
  if (body.length > BODY_MAX) {
    body = `${body.slice(0, BODY_MAX - 1)}…`;
  }
  return body;
}
