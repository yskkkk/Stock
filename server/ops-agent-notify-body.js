/**
 * 개발 변경·웹 에이전트 텔레그램 알림 본문 — 요청 + 응답 + Git 요약
 */

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

  const req = trimSection(opts.userRequest, REQUEST_MAX);
  if (req) {
    parts.push(`【개발 요청】\n${req}`);
  }

  if (state === "cancelled") {
    parts.push("【에이전트 응답】\n사용자가 요청을 중단했습니다.");
  } else if (state === "error") {
    const err =
      trimSection(
        opts.errorText ?? opts.agentResponse,
        RESPONSE_MAX,
      ) || "알 수 없는 오류";
    parts.push(`【에이전트 응답】\n${err}`);
  } else {
    const res =
      trimSection(opts.agentResponse, RESPONSE_MAX) || "(응답 없음)";
    parts.push(`【에이전트 응답】\n${res}`);
  }

  const git = String(opts.gitSummary ?? "").trim();
  if (git) {
    parts.push(`【반영 요약】\n${git}`);
  }

  const meta = [];
  if (opts.runtimeLabel) meta.push(`실행: ${opts.runtimeLabel}`);
  if (opts.durationMs != null && Number.isFinite(opts.durationMs)) {
    meta.push(`소요: ${Math.round(opts.durationMs / 1000)}초`);
  }
  if (meta.length) parts.push(`【실행 정보】\n${meta.join("\n")}`);

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
