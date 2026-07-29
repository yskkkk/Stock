/**
 * 가상 사용자 피드백 → OPS 텔레그램 (입력 프롬프트·답변만)
 */
import { formatOpsDevTelegramBody } from "./ops-dev-completion-coalesce.js";
import {
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

/**
 * @param {{
 *   prompt?: string;
 *   title?: string;
 *   detail?: string;
 *   suggestion?: string;
 *   implementResult?: string;
 *   improvementSummary?: string;
 * }} item
 */
function resolveVuNotifyPrompt(item) {
  const prompt = String(item?.prompt ?? "").trim();
  if (prompt && prompt !== "(생성 중)") return prompt;
  const title = String(item?.title ?? "").trim();
  const detail = String(item?.detail ?? "").trim();
  const suggestion = String(item?.suggestion ?? "").trim();
  return [title, detail, suggestion ? `제안: ${suggestion}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @param {{
 *   prompt?: string;
 *   title?: string;
 *   detail?: string;
 *   suggestion?: string;
 *   implementResult?: string;
 *   improvementSummary?: string;
 * }} item
 */
function resolveVuNotifyAnswer(item) {
  const done = String(item?.implementResult ?? "").trim();
  if (done) return done;
  const summary = String(item?.improvementSummary ?? "").trim();
  if (summary) return summary;
  const title = String(item?.title ?? "").trim();
  const detail = String(item?.detail ?? "").trim();
  const suggestion = String(item?.suggestion ?? "").trim();
  const finding = [title, detail, suggestion ? `제안: ${suggestion}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return finding || "(결과 대기)";
}

/**
 * @param {{
 *   id?: string;
 *   personaName?: string;
 *   severity?: string;
 *   area?: string;
 *   title?: string;
 *   detail?: string;
 *   suggestion?: string;
 *   prompt?: string;
 *   implementResult?: string;
 *   improvementSummary?: string;
 * }} item
 */
export async function notifyVirtualUserFeedback(item) {
  if (!isOpsTelegramNotifyEnabled()) {
    return { ok: false, reason: "ops_telegram_off" };
  }
  const creds = resolveOpsTelegramCreds();
  if (!creds.token || !creds.chatId) {
    return { ok: false, reason: "ops_creds_missing" };
  }

  const text = formatOpsDevTelegramBody(
    resolveVuNotifyPrompt(item),
    resolveVuNotifyAnswer(item),
    { requestMax: 2400, answerMax: 1200 },
  );

  const sent = await sendTelegramMessage(text, undefined, creds);
  return sent
    ? { ok: true, sentAtMs: Date.now() }
    : { ok: false, reason: "send_failed" };
}
