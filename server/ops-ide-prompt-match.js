/**
 * IDE 개발 큐·트랜스크립트·이력 — 동일 사용자 메시지 판별용.
 * preview(220자)와 본문·XML 태그 차이로 중복 등록되는 것을 막는다.
 */

/** @param {unknown} prompt */
export function normalizeOpsIdePrompt(prompt) {
  return String(prompt ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

/** @param {unknown} prompt */
export function opsIdePromptFingerprint(prompt) {
  return normalizeOpsIdePrompt(prompt);
}

/** @param {unknown} a @param {unknown} b */
export function opsIdePromptsMatch(a, b) {
  const fa = opsIdePromptFingerprint(a);
  const fb = opsIdePromptFingerprint(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const minLen = Math.min(fa.length, fb.length, 120);
  if (minLen >= 32) {
    return fa.slice(0, minLen) === fb.slice(0, minLen);
  }
  return false;
}
