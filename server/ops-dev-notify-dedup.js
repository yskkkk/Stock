/**
 * ops 개발 완료 텔레그램 — 동일 턴·동일 커밋 중복 발송 방지.
 */
import { getRepoHeadRev } from "./ops-agent-git-push.js";

const DEFAULT_DEDUP_MS = 5 * 60 * 1000;
const DEFAULT_AUTOGIT_SUPPRESS_MS = 8 * 60 * 1000;

/** @type {Map<string, number>} */
const sentAtByKey = new Map();

let lastCompletionRev = "";
let lastCompletionAt = 0;

function dedupWindowMs() {
  const n = Number(process.env.OPS_DEV_NOTIFY_DEDUP_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 60 * 60 * 1000);
  return DEFAULT_DEDUP_MS;
}

function autogitSuppressMs() {
  const n = Number(process.env.OPS_AUTOGIT_NOTIFY_SUPPRESS_AFTER_COMPLETION_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 60 * 60 * 1000);
  return DEFAULT_AUTOGIT_SUPPRESS_MS;
}

function pruneSentKeys() {
  const window = dedupWindowMs();
  const now = Date.now();
  for (const [k, at] of sentAtByKey) {
    if (now - at > window * 2) sentAtByKey.delete(k);
  }
}

/**
 * @param {string | null | undefined} dedupKey
 * @returns {boolean} true면 전송 생략
 */
export function shouldSkipOpsDevNotify(dedupKey) {
  const k = String(dedupKey ?? "").trim();
  if (!k) return false;
  if (dedupWindowMs() === 0) return false;
  const prev = sentAtByKey.get(k);
  if (prev != null && Date.now() - prev < dedupWindowMs()) {
    console.info(`[telegram:ops] skip duplicate notify (${k})`);
    return true;
  }
  return false;
}

/**
 * @param {string} dedupKey
 * @param {string} [gitHead]
 */
export function markOpsDevNotifySent(dedupKey, gitHead) {
  const k = String(dedupKey ?? "").trim();
  if (!k) return;
  sentAtByKey.set(k, Date.now());
  pruneSentKeys();
  const rev = String(gitHead ?? "").trim() || getRepoHeadRev();
  if (rev) {
    lastCompletionRev = rev;
    lastCompletionAt = Date.now();
  }
}

/**
 * 에이전트·IDE 완료 직후 같은 HEAD로 auto-git 알림이 또 가지 않게.
 * @param {string} newRev
 */
export function shouldSkipAutoGitPullNotify(newRev) {
  const rev = String(newRev ?? "").trim();
  if (!rev) return false;
  if (shouldSkipOpsDevNotify(`autogit:${rev}`)) return true;
  const suppress = autogitSuppressMs();
  if (
    suppress > 0 &&
    lastCompletionRev &&
    lastCompletionRev === rev &&
    Date.now() - lastCompletionAt < suppress
  ) {
    console.info(
      "[telegram:ops] skip auto-git notify (recent agent/IDE completion same HEAD)",
    );
    return true;
  }
  return false;
}
