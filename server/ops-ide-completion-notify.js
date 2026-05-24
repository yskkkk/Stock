/**

 * Cursor IDE 개발 완료 텔레그램 — 큐 release 여부와 무관하게 턴당 1통.

 */

import { createHash } from "node:crypto";

import fs from "node:fs";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { opsIdePromptFingerprint } from "./ops-ide-prompt-match.js";

import { getRepoHeadRev } from "./ops-agent-git-push.js";

import {

  readAgentResponseForIdeSession,

  readIdeTurnNotifyPair,

} from "./ops-ide-transcript-text.js";

import {

  buildOpsDevNotifyDedupKey,

  shouldSkipOpsDevNotify,

} from "./ops-dev-notify-dedup.js";

import { scheduleOpsDevCompletionTelegram } from "./ops-dev-completion-coalesce.js";

import {

  summarizeGitPullRangeForNotify,

  summarizeGitReflectionForNotify,

} from "./ops-agent-git-push.js";

import {

  sendChatNoCodeTelegram,

  shouldSkipIdeCompletionForChatTurn,

} from "./ops-chat-no-code-notify.js";

import { isOpsTelegramNotifyEnabled } from "./telegram-notify.js";



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IDE_SENT_FILE = path.join(__dirname, ".data", "ops-ide-completion-sent.json");

const IDE_SENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;



/** @type {Map<string, number>} */

const notifiedTurnKeys = new Map();



const TURN_NOTIFY_TTL_MS = 15 * 60 * 1000;



function ensureDataDir() {

  const dir = path.dirname(IDE_SENT_FILE);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

}



/** @returns {Record<string, number>} */

function readIdeSentDisk() {

  try {

    if (!fs.existsSync(IDE_SENT_FILE)) return {};

    const o = JSON.parse(fs.readFileSync(IDE_SENT_FILE, "utf8"));

    if (!o || typeof o !== "object" || !o.entries) return {};

    return /** @type {Record<string, number>} */ (o.entries);

  } catch {

    return {};

  }

}



/** @param {Record<string, number>} entries */

function writeIdeSentDisk(entries) {

  ensureDataDir();

  const now = Date.now();

  const pruned = {};

  for (const [k, at] of Object.entries(entries)) {

    if (typeof at === "number" && now - at <= IDE_SENT_TTL_MS) {

      pruned[k] = at;

    }

  }

  fs.writeFileSync(

    IDE_SENT_FILE,

    JSON.stringify({ entries: pruned, updatedAtMs: now }, null, 0),

    "utf8",

  );

}



function ideTurnSentOnDisk(turnKey) {

  const at = readIdeSentDisk()[turnKey];

  return typeof at === "number" && Date.now() - at < IDE_SENT_TTL_MS;

}



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

  const turnKey = buildIdeCompletionTurnKey(sessionId, req);

  if (ideTurnSentOnDisk(turnKey)) return true;

  return alreadyNotifiedThisTurn(turnKey);

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



/** @param {string} turnKey */

export function markIdeCompletionTurnNotified(turnKey) {

  const k = String(turnKey ?? "").trim();

  if (!k) return;

  notifiedTurnKeys.set(k, Date.now());

  try {

    const disk = readIdeSentDisk();

    disk[k] = Date.now();

    writeIdeSentDisk(disk);

  } catch {

    /* ignore */

  }

}



/** @param {string} turnKey */

export function unmarkIdeCompletionTurnNotified(turnKey) {

  const k = String(turnKey ?? "").trim();

  if (!k) return;

  notifiedTurnKeys.delete(k);

  try {

    const disk = readIdeSentDisk();

    if (disk[k] != null) {

      delete disk[k];

      writeIdeSentDisk(disk);

    }

  } catch {

    /* ignore */

  }

}



/**

 * @param {{

 *   userRequest: string;

 *   sessionId?: string | null;

 *   transcriptPath?: string | null;

 *   gitRevAtStart?: string | null;

 *   userLineIndex?: number;

 *   leaseId?: string | null;

 *   force?: boolean;

 * }} opts

 * @returns {boolean} 스케줄 여부

 */

export function notifyIdeDevelopmentCompleted(opts) {

  const userRequest = String(opts.userRequest ?? "").trim();

  if (!userRequest) return false;



  const sessionId = String(opts.sessionId ?? "").trim() || null;

  const turnKey = buildIdeCompletionTurnKey(sessionId, userRequest);



  if (!opts.force && isIdeCompletionNotified(sessionId, userRequest)) {

    return false;

  }



  if (!opts.force && shouldSkipIdeCompletionForChatTurn(userRequest)) {

    void sendChatNoCodeTelegram({

      userRequest,

      sessionId,

    });

    return false;

  }



  if (!isOpsTelegramNotifyEnabled()) {

    console.warn(

      "[telegram:ops] IDE 개발 완료 알림 생략 — TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_CHAT_ID 확인",

    );

    return false;

  }



  const transcriptPath = String(opts.transcriptPath ?? "").trim();

  let pairedRequest = userRequest;

  let agentResponse = "";

  let userLineIndex =

    typeof opts.userLineIndex === "number" ? opts.userLineIndex : -1;



  if (transcriptPath) {

    const pair = readIdeTurnNotifyPair(

      transcriptPath,

      userRequest,

      userLineIndex >= 0 ? userLineIndex : undefined,

    );

    pairedRequest = String(pair.userRequest ?? userRequest).trim() || userRequest;

    agentResponse = String(pair.agentResponse ?? "").trim();

    userLineIndex = pair.userLineIndex;

  }



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



  const dedupKey = buildOpsDevNotifyDedupKey({

    turnId: turnKey,

    userRequest: pairedRequest,

    agentResponse,

    gitSummary,

    state: "ok",

  });

  if (!opts.force && shouldSkipOpsDevNotify(dedupKey)) {

    return false;

  }



  markIdeCompletionTurnNotified(turnKey);



  scheduleOpsDevCompletionTelegram({

    title: "개발 완료",

    userRequest: pairedRequest,

    agentResponse,

    gitSummary,

    priority: 3,

    turnId: turnKey,

    sessionId,

    transcriptPath: transcriptPath || undefined,

    gitRevAtStart: revStart || undefined,

    userLineIndex: userLineIndex >= 0 ? userLineIndex : undefined,

  });



  return true;

}


