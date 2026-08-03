/**
 * 개발 변경·웹 에이전트 텔레그램 알림 본문 — 사용자 입력 + 결과 반영만
 */
import { unwrapOpsOperatorRequest } from "./ops-ide-prompt-match.js";

const BODY_MAX = 3800;
const REQUEST_MAX = 1000;
const RESPONSE_MAX = 2200;

/**
 * @param {string} text
 * @param {number} max
 */
function trimSection(text, max) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {{
 *   userRequest?: string | null;
 *   agentResponse?: string | null;
 *   gitSummary?: string | null;
 *   state?: "ok" | "error" | "cancelled";
 *   errorText?: string | null;
 *   runtimeLabel?: string | null;
 *   durationMs?: number | null;
 * }} opts
 */
export function buildOpsDevChangeTelegramBody(opts) {
  const state = opts.state ?? "ok";
  const parts = [];

  const req = trimSection(unwrapOpsOperatorRequest(opts.userRequest), REQUEST_MAX);
  if (req) {
    parts.push(`사용자 입력 프롬프트:\n${req}`);
  }

  if (state === "cancelled") {
    parts.push("결과 반영:\n사용자가 요청을 중단했습니다.");
  } else if (state === "error") {
    const err =
      trimSection(
        opts.errorText ?? opts.agentResponse,
        RESPONSE_MAX,
      ) || "알 수 없는 오류";
    parts.push(`결과 반영:\n${err}`);
  } else {
    const res =
      trimSection(opts.agentResponse, RESPONSE_MAX) || "(결과 없음)";
    parts.push(`결과 반영:\n${res}`);
  }

  // git·실행 메타는 개발 알림에 넣지 않음 (입력·결과만)

  let body = parts.join("\n\n");
  if (body.length > BODY_MAX) {
    body = `${body.slice(0, BODY_MAX - 1)}…`;
  }
  return body;
}

/**
 * @param {string | null | undefined} resultText
 * @param {string | null | undefined} streamText
 */
export function pickOpsAgentResponseText(resultText, streamText) {
  let t = String(resultText ?? "").trim();
  const onlyPostProcess =
    !t ||
    t === "(내용 없음)" ||
    (t.startsWith("[후처리]") && t.length < 400);
  if (onlyPostProcess) {
    const stream = String(streamText ?? "").trim();
    if (stream.length > 0) t = stream;
  }
  if (!t) return "";
  const postIdx = t.indexOf("\n\n[후처리]");
  if (postIdx >= 0) {
    const head = t.slice(0, postIdx).trim();
    if (head) return head;
  }
  return t;
}

/**
 * @param {{
 *   state: "ok" | "error" | "cancelled";
 *   capture: {
 *     instruction?: string;
 *     resultText?: string | null;
 *     streamText?: string;
 *     runtimeLabel?: string | null;
 *     durationMs?: number | null;
 *     gitSummary?: string;
 *   };
 *   errorText?: string | null;
 * }} input
 */
export function buildOpsAgentTelegramBody(input) {
  const { state, capture, errorText } = input;
  return buildOpsDevChangeTelegramBody({
    state,
    errorText,
    userRequest: capture.instruction,
    agentResponse: pickOpsAgentResponseText(
      capture.resultText,
      capture.streamText,
    ),
    gitSummary: capture.gitSummary,
    runtimeLabel: capture.runtimeLabel,
    durationMs: capture.durationMs,
  });
}
