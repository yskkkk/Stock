/** 운영 탭 Cursor 에이전트 SSE 상태·메시지 한글 */

/** @type {Record<string, string>} */
const CURSOR_STATUS_KO = {
  creating: "에이전트 준비 중",
  running: "실행 중",
  finished: "완료",
  completed: "완료",
  success: "완료",
  succeeded: "완료",
  error: "오류",
  failed: "실패",
  cancelled: "중단됨",
  canceled: "중단됨",
  expired: "만료됨",
  queued: "대기 중",
  pending: "대기 중",
  in_progress: "진행 중",
  thinking: "추론 중",
};

/** @type {Array<[RegExp, string]>} */
const DETAIL_PHRASES = [
  [/provisioning/i, "환경 준비"],
  [/cloning/i, "저장소 복제"],
  [/clone/i, "저장소 복제"],
  [/connecting/i, "연결 중"],
  [/connected/i, "연결됨"],
  [/waiting/i, "대기 중"],
  [/tool/i, "도구 실행"],
  [/thinking/i, "추론 중"],
  [/generating/i, "응답 생성 중"],
  [/streaming/i, "스트림 수신 중"],
];

/**
 * @param {string} status
 */
export function cursorAgentStatusKo(status) {
  const raw = String(status ?? "").trim();
  if (!raw) return "진행 중";
  const key = raw.toLowerCase();
  return CURSOR_STATUS_KO[key] ?? CURSOR_STATUS_KO[raw] ?? raw;
}

/**
 * @param {string} detail
 */
export function cursorAgentDetailKo(detail) {
  const raw = String(detail ?? "").trim();
  if (!raw) return "";
  for (const [re, ko] of DETAIL_PHRASES) {
    if (re.test(raw)) return ko;
  }
  return raw;
}

/**
 * @param {string} status
 * @param {string} [detail]
 */
export function formatOpsCursorStatusLine(status, detail = "") {
  const stKo = cursorAgentStatusKo(status);
  const detKo = cursorAgentDetailKo(detail);
  if (detKo && detKo !== stKo) return `${stKo} — ${detKo}`;
  return stKo;
}

/**
 * @param {string} runtime
 */
export function opsAgentRuntimeKo(runtime) {
  const r = String(runtime ?? "").trim().toLowerCase();
  if (r === "local") return "로컬";
  if (r === "cloud") return "클라우드";
  return runtime ? String(runtime) : "";
}
