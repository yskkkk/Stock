/**
 * 개발 완료 텔레그램 — 짧은 시간에 여러 번 호출돼도 마지막 1통만 발송.
 */
import { getRepoHeadRev } from "./ops-agent-git-push.js";
import { markOpsDevNotifySent } from "./ops-dev-notify-dedup.js";
import {
  escHtml,
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const BODY_MAX = 3600;
const REQUEST_MAX = 1400;
const COMPLETION_MAX = 2000;

/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;

/** @type {{
 *   userRequest: string;
 *   completion: string;
 *   title: string;
 *   priority: number;
 *   at: number;
 * } | null} */
let pending = null;

function debounceMs() {
  const n = Number(process.env.OPS_DEV_NOTIFY_DEBOUNCE_MS);
  if (Number.isFinite(n) && n >= 2000) return Math.min(n, 120_000);
  return 12_000;
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
 * }} opts
 */
/** 에이전트·IDE 완료가 대기 중이면 auto-git 알림을 붙이지 않음 */
export function hasOpsDevCompletionPending() {
  return pending != null;
}

export function scheduleOpsDevCompletionTelegram(opts) {
  if (!isOpsTelegramNotifyEnabled()) return;
  if (process.env.OPS_DEV_NOTIFY_COALESCE === "0") {
    void flushOpsDevCompletionNow(opts);
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

  if (!pending || priority >= pending.priority) {
    pending = {
      userRequest: userRequest || "(요청 없음)",
      completion: completion || "—",
      title,
      priority,
      at: Date.now(),
    };
  } else if (git && pending) {
    const extra = trimBlock(git.split("\n").slice(0, 4).join("\n"), 400);
    if (extra && !pending.completion.includes(extra)) {
      pending.completion = `${pending.completion}\n\n[반영] ${extra}`;
    }
  }

  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, debounceMs());
}

/**
 * @param {Parameters<typeof scheduleOpsDevCompletionTelegram>[0]} opts
 */
async function flushOpsDevCompletionNow(opts) {
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
  await sendCompletionMessage({
    title: opts.title ?? "개발 완료",
    userRequest: userRequest || "(요청 없음)",
    completion,
  });
}

async function flushPending() {
  const snap = pending;
  pending = null;
  if (!snap) return;
  await sendCompletionMessage(snap);
}

/**
 * @param {{ title: string; userRequest: string; completion: string }} snap
 */
async function sendCompletionMessage(snap) {
  if (!isOpsTelegramNotifyEnabled()) return false;

  let body = `요청:\n${snap.userRequest}\n\n완료:\n${snap.completion}`;
  if (body.length > BODY_MAX) {
    body = `${body.slice(0, BODY_MAX - 1)}…`;
  }

  const text = [`<b>${escHtml(snap.title)}</b>`, "", escHtml(body)].join("\n");

  const ok = await sendTelegramMessage(text, undefined, resolveOpsTelegramCreds());
  if (ok) {
    markOpsDevNotifySent("coalesce:last", getRepoHeadRev());
    console.info("[telegram:ops] dev completion (coalesced) sent");
  } else {
    console.warn("[telegram:ops] dev completion (coalesced) failed");
  }
  return ok;
}
