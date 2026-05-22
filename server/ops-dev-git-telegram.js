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
 * }} opts
 */
export function notifyOpsDevGitReflection(opts) {
  const detail = String(opts.detail ?? "").trim();
  scheduleOpsDevCompletionTelegram({
    title: String(opts.title ?? "").trim() || "개발 완료",
    userRequest: (opts.userRequest ?? detail) || "(자동 반영)",
    agentResponse: opts.agentResponse,
    gitSummary: opts.gitSummary,
    state: opts.state,
    errorText: opts.errorText,
    priority: opts.priority ?? 2,
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
    userRequest: `${opts.remote}/${opts.branch} pull`,
    agentResponse: opts.gitSummary,
    priority: 1,
  });
}
