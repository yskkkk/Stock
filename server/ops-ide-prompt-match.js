/**
 * IDE 개발 큐·트랜스크립트·이력 — 동일 사용자 메시지 판별용.
 * preview(220자)와 본문·XML 태그 차이로 중복 등록되는 것을 막는다.
 */

/**
 * 에이전트용 영문 래퍼(「local git repository」등)·Git 강제 문구를 빼고
 * 실제 작업 지시만 남긴다. 텔레그램·큐 미리보기에 영문 보일러플레이트가 나가지 않게 한다.
 * @param {unknown} prompt
 */
export function unwrapOpsOperatorRequest(prompt) {
  let t = String(prompt ?? "").trim();
  if (!t) return "";

  const taskHeader = t.match(
    /##\s*작업\s*지시\s*\r?\n+([\s\S]*?)(?=\r?\n##\s+Git(?:\s|\(|$)|$)/i,
  );
  if (taskHeader) {
    t = taskHeader[1].trim();
  } else if (/You are working in the local git repository/i.test(t)) {
    const op = t.match(
      /##\s*Operator request\s*\r?\n+([\s\S]*?)(?=\r?\n##\s+Git(?:\s|\(|$)|$)/i,
    );
    if (op) {
      t = op[1].replace(/^##\s*작업\s*지시\s*\r?\n+/i, "").trim();
    } else {
      t = t
        .replace(
          /^[\s\S]*?You are working in the local git repository[^\n]*\n?/i,
          "",
        )
        .replace(/^Apply the operator's request[^\n]*\n?/im, "")
        .replace(/^##\s*Operator request\s*\r?\n+/im, "")
        .replace(/^##\s*작업\s*지시\s*\r?\n+/im, "")
        .replace(/\r?\n##\s*Git[\s\S]*$/i, "")
        .trim();
    }
  }

  t = t.replace(/\r?\n##\s*Git[\s\S]*$/i, "").trim();
  return t;
}

/** @param {unknown} prompt */
export function normalizeOpsIdePrompt(prompt) {
  return unwrapOpsOperatorRequest(prompt)
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
