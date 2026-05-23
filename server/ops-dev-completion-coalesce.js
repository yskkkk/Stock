/**
 * 개발 완료 텔레그램 — 짧은 시간에 여러 번 호출돼도 마지막 1통만 발송.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readAgentResponseForIdeSession,
  readAgentResponseFromTranscriptFile,
} from "./ops-ide-transcript-text.js";
import {
  buildOpsDevNotifyDedupKey,
  buildOpsDevNotifyDedupKeyFromSnap,
  markOpsDevNotifySent,
  clearStaleOpsDevNotifyLocks,
  releaseOpsDevNotifySendLock,
  shouldSkipOpsDevNotify,
  tryAcquireOpsDevNotifySend,
} from "./ops-dev-notify-dedup.js";
import {
  getRepoHeadRev,
  getRepoPushSyncState,
  summarizeGitPullRangeForNotify,
  summarizeGitReflectionForNotify,
} from "./ops-agent-git-push.js";
import {
  escHtml,
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PENDING_FILE = path.join(__dirname, ".data", "ops-dev-notify-pending.json");

const BODY_MAX = 3600;
const REQUEST_MAX = 1400;
const COMPLETION_MAX = 2000;

/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;

let flushInFlight = false;

/** @type {{
 *   userRequest: string;
 *   completion: string;
 *   title: string;
 *   priority: number;
 *   turnId: string | null;
 *   at: number;
 *   sessionId?: string | null;
 *   transcriptPath?: string | null;
 *   gitRevAtStart?: string | null;
 * } | null} */
let pending = null;

function postWorkSettleMs(priority = 1) {
  const n = Number(process.env.OPS_DEV_NOTIFY_POST_WORK_MS);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 120_000);
  if (priority >= 3) return 8_000;
  if (priority >= 2) return 5_000;
  return 2_000;
}

/** git push 완료 대기 상한 (settle 이후 추가) */
function pushWaitMaxMs(priority = 1) {
  const n = Number(process.env.OPS_DEV_NOTIFY_PUSH_WAIT_MS);
  if (Number.isFinite(n) && n >= 5_000) return Math.min(n, 300_000);
  if (priority >= 3) return 120_000;
  if (priority >= 2) return 90_000;
  return 60_000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** git push·transcript flush 후 발송 — push 전 조기 알림 방지 */
async function waitForGitPushSettled(snap) {
  const priority = Number(snap.priority) || 1;
  const settleMs = postWorkSettleMs(priority);
  const scheduledAt = typeof snap.at === "number" ? snap.at : Date.now();
  const gitRevStart = String(snap.gitRevAtStart ?? "").trim();
  const deadline = scheduledAt + settleMs + pushWaitMaxMs(priority);

  while (Date.now() < deadline) {
    const elapsed = Date.now() - scheduledAt;
    if (elapsed < settleMs) {
      await sleep(400);
      continue;
    }
    if (!gitRevStart) break;

    const st = getRepoPushSyncState();
    const revMoved = Boolean(gitRevStart && st.head && gitRevStart !== st.head);

    if (st.dirty) {
      await sleep(400);
      continue;
    }
    if (!revMoved && st.ahead === 0) break;
    if (revMoved && st.ahead === 0) break;

    await sleep(400);
  }
}

/** git push·transcript flush 후 발송 */
async function settleAndRefreshBeforeSend(snap) {
  await waitForGitPushSettled(snap);

  const transcriptPath = String(snap.transcriptPath ?? "").trim();
  const sessionId = String(snap.sessionId ?? "").trim();
  let fresh = "";
  if (transcriptPath) {
    fresh = readAgentResponseFromTranscriptFile(transcriptPath);
  } else if (sessionId) {
    fresh = readAgentResponseForIdeSession(sessionId);
  }
  if (fresh) {
    snap.completion = trimBlock(fresh, COMPLETION_MAX);
  }

  const revEnd = getRepoHeadRev();
  let gitSummary = "";
  if (gitRevStart && revEnd && gitRevStart !== revEnd) {
    gitSummary = summarizeGitPullRangeForNotify(gitRevStart, revEnd);
  } else if (gitRevStart || snap.turnId?.startsWith("ide-turn:")) {
    gitSummary = summarizeGitReflectionForNotify("local");
  }
  if (gitSummary) {
    const gitShort = trimBlock(gitSummary.split("\n").slice(0, 6).join("\n"), 600);
    const base = String(snap.completion ?? "")
      .replace(/\n\n\[반영\][\s\S]*$/u, "")
      .trim();
    snap.completion = base ? `${base}\n\n[반영] ${gitShort}` : gitShort;
  }
}

function debounceMs(priority = 1) {
  const n = Number(process.env.OPS_DEV_NOTIFY_DEBOUNCE_MS);
  if (Number.isFinite(n) && n >= 2000) return Math.min(n, 120_000);
  if (priority >= 3) return 3_000;
  return 12_000;
}

function writePendingDisk() {
  if (!pending) return;
  try {
    const dir = path.dirname(PENDING_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PENDING_FILE, JSON.stringify({ pending }), "utf8");
  } catch {
    /* ignore */
  }
}

function clearPendingDisk() {
  try {
    if (fs.existsSync(PENDING_FILE)) fs.unlinkSync(PENDING_FILE);
  } catch {
    /* ignore */
  }
}

function trimBlock(text, max) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {string | null | undefined} resultText
 * @param {string | null | undefined} streamText
 */
export function normalizeOpsCompletionText(resultText, streamText) {
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
 *   userRequest?: string | null;
 *   agentResponse?: string | null;
 *   errorText?: string | null;
 *   state?: "ok" | "error" | "cancelled";
 *   gitSummary?: string | null;
 *   title?: string;
 *   priority?: number;
 *   turnId?: string | null;
 *   sessionId?: string | null;
 *   transcriptPath?: string | null;
 *   gitRevAtStart?: string | null;
 * }} opts
 */
/** 에이전트·IDE 완료가 대기 중이면 auto-git 알림을 붙이지 않음 */
export function hasOpsDevCompletionPending() {
  return pending != null;
}

export function scheduleOpsDevCompletionTelegram(opts) {
  if (!isOpsTelegramNotifyEnabled()) {
    console.warn(
      "[telegram:ops] 개발 완료 알림 미설정 — TELEGRAM_OPS_BOT_TOKEN / TELEGRAM_OPS_CHAT_ID",
    );
    return;
  }

  const dedupKey = buildOpsDevNotifyDedupKey(opts);
  if (shouldSkipOpsDevNotify(dedupKey)) return;

  if (process.env.OPS_DEV_NOTIFY_COALESCE === "0") {
    void flushOpsDevCompletionNow(opts, dedupKey);
    return;
  }

  const priority = Number(opts.priority) || 1;
  const userRequest = trimBlock(
    opts.userRequest ?? opts.title ?? "",
    REQUEST_MAX,
  );
  let completion = "";
  const state = opts.state ?? "ok";
  if (state === "cancelled") {
    completion = "사용자가 요청을 중단했습니다.";
  } else if (state === "error") {
    completion =
      trimBlock(opts.errorText ?? opts.agentResponse, COMPLETION_MAX) ||
      "알 수 없는 오류";
  } else {
    completion =
      trimBlock(opts.agentResponse, COMPLETION_MAX) || "(응답 없음)";
  }

  const git = String(opts.gitSummary ?? "").trim();
  if (git) {
    const gitShort = trimBlock(
      git.split("\n").slice(0, 6).join("\n"),
      600,
    );
    completion = completion
      ? `${completion}\n\n[반영] ${gitShort}`
      : gitShort;
  }

  const title = String(opts.title ?? "").trim() || "개발 완료";
  const turnId = String(opts.turnId ?? "").trim() || null;
  const sessionId = String(opts.sessionId ?? "").trim() || null;
  const transcriptPath = String(opts.transcriptPath ?? "").trim() || null;
  const gitRevAtStart = String(opts.gitRevAtStart ?? "").trim() || null;

  if (!pending || priority >= pending.priority) {
    pending = {
      userRequest: userRequest || "(요청 없음)",
      completion: completion || "—",
      title,
      priority,
      turnId,
      sessionId,
      transcriptPath,
      gitRevAtStart,
      at: Date.now(),
    };
  } else if (git && pending) {
    const extra = trimBlock(git.split("\n").slice(0, 4).join("\n"), 400);
    if (extra && !pending.completion.includes(extra)) {
      pending.completion = `${pending.completion}\n\n[반영] ${extra}`;
    }
  }

  writePendingDisk();

  if (flushTimer) clearTimeout(flushTimer);
  const waitMs = debounceMs(priority);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, waitMs);
}

/**
 * @param {Parameters<typeof scheduleOpsDevCompletionTelegram>[0]} opts
 */
async function flushOpsDevCompletionNow(opts, dedupKey) {
  const key = dedupKey ?? buildOpsDevNotifyDedupKey(opts);
  const userRequest = trimBlock(
    opts.userRequest ?? opts.title ?? "",
    REQUEST_MAX,
  );
  let completion = "";
  if ((opts.state ?? "ok") === "cancelled") {
    completion = "사용자가 요청을 중단했습니다.";
  } else if (opts.state === "error") {
    completion =
      trimBlock(opts.errorText ?? opts.agentResponse, COMPLETION_MAX) ||
      "알 수 없는 오류";
  } else {
    completion =
      trimBlock(opts.agentResponse, COMPLETION_MAX) || "(응답 없음)";
  }
  const snap = {
    completion,
    priority: Number(opts.priority) || 1,
    at: Date.now(),
    turnId: String(opts.turnId ?? "").trim() || null,
    sessionId: String(opts.sessionId ?? "").trim() || null,
    transcriptPath: String(opts.transcriptPath ?? "").trim() || null,
    gitRevAtStart: String(opts.gitRevAtStart ?? "").trim() || null,
  };
  if ((opts.state ?? "ok") === "ok") {
    await settleAndRefreshBeforeSend(snap);
  }
  await sendCompletionMessage(
    {
      title: opts.title ?? "개발 완료",
      userRequest: userRequest || "(요청 없음)",
      completion: snap.completion,
    },
    key,
  );
}

async function flushPending() {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const snap = pending;
    pending = null;
    clearPendingDisk();
    if (!snap) return;
    await settleAndRefreshBeforeSend(snap);
    const key = buildOpsDevNotifyDedupKeyFromSnap(snap);
    await sendCompletionMessage(snap, key);
  } finally {
    flushInFlight = false;
  }
}

/** Vite 재기동 등으로 debounce 타이머가 끊긴 pending 1통 복구 */
export async function flushOpsDevNotifyPendingFromDisk() {
  if (!isOpsTelegramNotifyEnabled()) return false;
  let raw = null;
  try {
    if (!fs.existsSync(PENDING_FILE)) return false;
    raw = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
  } catch {
    clearPendingDisk();
    return false;
  }
  const snap = raw?.pending;
  if (!snap?.at) {
    clearPendingDisk();
    return false;
  }
  const age = Date.now() - snap.at;
  const pri = snap.priority ?? 1;
  const wait =
    debounceMs(pri) + postWorkSettleMs(pri) + pushWaitMaxMs(pri);
  if (age < wait - 300) {
    const delay = Math.max(500, wait - age);
    setTimeout(() => {
      void flushOpsDevNotifyPendingFromDisk();
    }, delay);
    return false;
  }
  if (shouldSkipOpsDevNotify(buildOpsDevNotifyDedupKeyFromSnap(snap))) {
    clearPendingDisk();
    return false;
  }
  await settleAndRefreshBeforeSend(snap);
  return sendCompletionMessage(snap, buildOpsDevNotifyDedupKeyFromSnap(snap));
}

/**
 * @param {{ title: string; userRequest: string; completion: string }} snap
 */
/**
 * @param {{ title: string; userRequest: string; completion: string }} snap
 * @param {string} dedupKey
 */
async function sendCompletionMessage(snap, dedupKey) {
  if (!isOpsTelegramNotifyEnabled()) return false;
  if (shouldSkipOpsDevNotify(dedupKey)) return false;
  if (!tryAcquireOpsDevNotifySend(dedupKey)) return false;

  let body = `요청:\n${snap.userRequest}\n\n완료:\n${snap.completion}`;
  if (body.length > BODY_MAX) {
    body = `${body.slice(0, BODY_MAX - 1)}…`;
  }

  const text = [`<b>${escHtml(snap.title)}</b>`, "", escHtml(body)].join("\n");

  const ok = await sendTelegramMessage(text, undefined, resolveOpsTelegramCreds());
  if (ok) {
    markOpsDevNotifySent(dedupKey, getRepoHeadRev());
    const turnId = String(snap.turnId ?? "").trim();
    if (turnId.startsWith("ide-turn:")) {
      void import("./ops-ide-completion-notify.js").then((m) =>
        m.markIdeCompletionTurnNotified(turnId),
      );
    }
    console.info("[telegram:ops] dev completion (coalesced) sent");
  } else {
    releaseOpsDevNotifySendLock(dedupKey);
    console.warn(
      "[telegram:ops] dev completion (coalesced) failed — 토큰·chat_id·HTML 본문 확인",
    );
  }
  return ok;
}

clearStaleOpsDevNotifyLocks();
void flushOpsDevNotifyPendingFromDisk();
