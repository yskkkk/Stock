/**
 * Cursor IDE 개발 완료 텔레그램 — 큐 release 여부와 무관하게 턴당 1통.
 */
import { createHash } from "node:crypto";
import { opsIdePromptFingerprint } from "./ops-ide-prompt-match.js";
import { getRepoHeadRev } from "./ops-agent-git-push.js";
import {
  readAgentResponseForIdeSession,
  readAgentResponseFromTranscriptFile,
} from "./ops-ide-transcript-text.js";
import { scheduleOpsDevCompletionTelegram } from "./ops-dev-completion-coalesce.js";
import {
  summarizeGitPullRangeForNotify,
  summarizeGitReflectionForNotify,
} from "./ops-agent-git-push.js";
import { isOpsTelegramNotifyEnabled } from "./telegram-notify.js";

/** @type {Map<string, number>} */
const notifiedTurnKeys = new Map();

const TURN_NOTIFY_TTL_MS = 15 * 60 * 1000;

/**
 * @param {string | null | undefined} sessionId
 * @param {string | null | undefined} userRequest
 */
export function buildIdeCompletionTurnKey(sessionId, userRequest) {
  const sid = String(sessionId ?? "").trim() || "no-session";
  const req = opsIdePromptFingerprint(userRequest).slice(0, 320);
  const h = createHash("sha256").update(`${sid}\n${req}`).digest("hex").slice(0, 14);
  return `ide-turn:${sid}:${h}`;
}

/** @param {string | null | undefined} sessionId @param {string | null | undefined} userRequest */
export function isIdeCompletionNotified(sessionId, userRequest) {
  const req = opsIdePromptFingerprint(userRequest);
  if (!req) return false;
  return alreadyNotifiedThisTurn(buildIdeCompletionTurnKey(sessionId, req));
}

function pruneNotifiedTurnKeys() {
  const now = Date.now();
  for (const [k, at] of notifiedTurnKeys) {
    if (now - at > TURN_NOTIFY_TTL_MS) notifiedTurnKeys.delete(k);
  }
}

function alreadyNotifiedThisTurn(turnKey) {
  pruneNotifiedTurnKeys();
  return notifiedTurnKeys.has(turnKey);
}

function markTurnNotified(turnKey) {
  notifiedTurnKeys.set(turnKey, Date.now());
}

/**
 * @param {{
 *   userRequest: string;
 *   sessionId?: string | null;
 *   transcriptPath?: string | null;
 *   gitRevAtStart?: string | null;
 *   leaseId?: string | null;
 *   force?: boolean;
 * }} opts
 * @returns {boolean} 스케줄 여부
 */
export function notifyIdeDevelopmentCompleted(opts) {
  const userRequest = String(opts.userRequest ?? "").trim();
  if (!userRequest) return false;

  if (!isOpsTelegramNotifyEnabled()) {
    console.warn(
      "[telegram:ops] IDE 개발 완료 알림 생략 — TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_CHAT_ID 확인",
    );
    return false;
  }

  const sessionId = String(opts.sessionId ?? "").trim() || null;
  const turnKey = buildIdeCompletionTurnKey(sessionId, userRequest);
  if (!opts.force && alreadyNotifiedThisTurn(turnKey)) {
    return false;
  }

  const transcriptPath = String(opts.transcriptPath ?? "").trim();
  let agentResponse = transcriptPath
    ? readAgentResponseFromTranscriptFile(transcriptPath)
    : "";
  if (!agentResponse) {
    agentResponse = readAgentResponseForIdeSession(sessionId);
  }
  if (!agentResponse) {
    agentResponse =
      "Cursor IDE에서 작업이 끝났습니다. (transcript에서 응답 본문을 찾지 못했습니다.)";
  }

  const revEnd = getRepoHeadRev();
  const revStart = String(opts.gitRevAtStart ?? "").trim();
  const gitSummary =
    revStart && revEnd && revStart !== revEnd
      ? summarizeGitPullRangeForNotify(revStart, revEnd)
      : summarizeGitReflectionForNotify("local");

  markTurnNotified(turnKey);

  scheduleOpsDevCompletionTelegram({
    title: "개발 완료",
    userRequest,
    agentResponse,
    gitSummary,
    priority: 3,
    turnId: turnKey,
  });

  console.info(
    `[telegram:ops] IDE 개발 완료 알림 예약 (${turnKey.slice(0, 40)}…)`,
  );
  return true;
}
