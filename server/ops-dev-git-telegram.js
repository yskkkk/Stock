import { buildOpsDevChangeTelegramBody } from "./ops-agent-notify-body.js";
import {
  escHtml,
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

function autoGitTelegramNotifyEnabled() {
  const v = String(process.env.AUTO_GIT_TELEGRAM_NOTIFY ?? "")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return isOpsTelegramNotifyEnabled();
}

/**
 * 서버·auto-git·IDE 등 개발(Git) 반영 — ops 텔레그램 그룹.
 * @param {{
 *   title: string;
 *   userRequest?: string;
 *   agentResponse?: string;
 *   gitSummary?: string;
 *   detail?: string;
 *   source?: string;
 *   state?: "ok" | "error" | "cancelled";
 *   errorText?: string | null;
 *   runtimeLabel?: string | null;
 *   durationMs?: number | null;
 * }} opts
 * @returns {Promise<boolean>}
 */
export async function notifyOpsDevGitReflection(opts) {
  if (!isOpsTelegramNotifyEnabled()) return false;

  const title = String(opts.title ?? "").trim() || "개발 반영";
  const detail = String(opts.detail ?? "").trim();
  const source = String(opts.source ?? "").trim();

  let body = buildOpsDevChangeTelegramBody({
    state: opts.state ?? "ok",
    errorText: opts.errorText,
    userRequest: opts.userRequest ?? (detail || undefined),
    agentResponse: opts.agentResponse,
    gitSummary: opts.gitSummary,
    runtimeLabel: opts.runtimeLabel,
    durationMs: opts.durationMs,
  });
  if (!String(opts.userRequest ?? "").trim() && detail) {
    body = `${detail}\n\n${body}`.trim();
  }

  const lines = [`<b>${escHtml(title)}</b>`];
  if (source) lines.push(`<i>${escHtml(source)}</i>`);
  lines.push("", escHtml(body));
  const text = lines.join("\n");

  const opsCreds = resolveOpsTelegramCreds();
  const ok = await sendTelegramMessage(text, undefined, opsCreds);
  if (ok) {
    console.log("[telegram:ops] dev git reflection notice sent");
  } else {
    console.warn("[telegram:ops] dev git reflection notice failed");
  }
  return ok;
}

/**
 * auto-git pull 성공 후 ops 알림 (기본 켜짐, `AUTO_GIT_TELEGRAM_NOTIFY=0` 으로 끔).
 * @param {{ gitSummary: string; remote: string; branch: string }} opts
 */
export function notifyOpsAutoGitPulled(opts) {
  if (!autoGitTelegramNotifyEnabled()) return;
  void notifyOpsDevGitReflection({
    title: "서버에 새 개발 내용이 반영됨",
    source: "auto-git · GitHub → 서버",
    detail: `${opts.remote}/${opts.branch} 브랜치를 서버가 받아 왔습니다.`,
    gitSummary: opts.gitSummary,
  });
}
