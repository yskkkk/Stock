import {
  hasOpsDevCompletionPending,
  scheduleOpsDevCompletionTelegram,
} from "./ops-dev-completion-coalesce.js";
import { shouldSkipAutoGitPullNotify } from "./ops-dev-notify-dedup.js";
import { isOpsTelegramNotifyEnabled } from "./telegram-notify.js";

function autoGitTelegramNotifyEnabled() {
  const v = String(process.env.AUTO_GIT_TELEGRAM_NOTIFY ?? "")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return isOpsTelegramNotifyEnabled();
}

/**
 * @param {{
 *   title?: string;
 *   userRequest?: string;
 *   agentResponse?: string;
 *   gitSummary?: string;
 *   detail?: string;
 *   source?: string;
 *   state?: "ok" | "error" | "cancelled";
 *   errorText?: string | null;
 *   runtimeLabel?: string | null;
 *   durationMs?: number | null;
 *   dedupKey?: string;
 *   priority?: number;
 *   turnId?: string | null;
 * }} opts
 */
export function notifyOpsDevGitReflection(opts) {
  const detail = String(opts.detail ?? "").trim();
  const userRequest =
    String(opts.userRequest ?? "").trim() || detail || "(자동 반영)";
  scheduleOpsDevCompletionTelegram({
    title: String(opts.title ?? "").trim() || "개발 완료",
    userRequest,
    agentResponse: opts.agentResponse,
    gitSummary: opts.gitSummary,
    state: opts.state,
    errorText: opts.errorText,
    priority: opts.priority ?? 2,
    turnId: opts.turnId,
  });
}

/**
 * @param {{ gitSummary: string; remote: string; branch: string; newRev: string }} opts
 */
export function notifyOpsAutoGitPulled(opts) {
  if (!autoGitTelegramNotifyEnabled()) return;
  const newRev = String(opts.newRev ?? "").trim();
  if (newRev && shouldSkipAutoGitPullNotify(newRev)) return;
  if (hasOpsDevCompletionPending()) return;
  scheduleOpsDevCompletionTelegram({
    title: "서버 반영",
    userRequest: "원격(GitHub)에서 최신 코드를 받아 이 PC/서버에 맞춥니다.",
    agentResponse:
      String(opts.gitSummary ?? "").trim() ||
      `${opts.remote}/${opts.branch} 반영 완료`,
    priority: 1,
  });
}

/**
 * @param {{ phase?: string; detail?: string; errorText?: string }} opts
 */
export function notifyOpsAutoGitFailed(opts) {
  if (!autoGitTelegramNotifyEnabled()) return;
  const errorText = String(opts.errorText ?? opts.detail ?? "").trim();
  if (!errorText) return;
  scheduleOpsDevCompletionTelegram({
    title: "auto-git 오류",
    userRequest: String(opts.phase ?? "auto-git sync").trim() || "auto-git sync",
    agentResponse: String(opts.detail ?? "").trim() || errorText,
    state: "error",
    errorText,
    priority: 2,
  });
}
