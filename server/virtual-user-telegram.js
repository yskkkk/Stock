/**
 * 가상 사용자 피드백 → OPS 텔레그램 간단 알림
 */
import {
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function kstNowLabel() {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * @param {{
 *   id?: string;
 *   personaName?: string;
 *   severity?: string;
 *   area?: string;
 *   title?: string;
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

  const sev = String(item?.severity ?? "minor");
  const title = String(item?.title ?? "").trim() || "(제목 없음)";
  const persona = String(item?.personaName ?? "").trim() || "가상 사용자";
  const area = String(item?.area ?? "").trim() || "—";
  const idShort = String(item?.id ?? "").slice(0, 8);

  const lines = [
    "<b>가상 사용자 피드백</b>",
    "",
    `👤 ${escHtml(persona)}`,
    `🏷 ${escHtml(sev)} · ${escHtml(area)}`,
    `📝 ${escHtml(title.slice(0, 160))}`,
  ];
  if (idShort) lines.push(`🆔 <code>${escHtml(idShort)}</code>`);
  lines.push("", `<i>🕐 ${kstNowLabel()} KST · 관리자 → 가상 사용자</i>`);

  const sent = await sendTelegramMessage(lines.join("\n"), undefined, creds);
  return sent
    ? { ok: true, sentAtMs: Date.now() }
    : { ok: false, reason: "send_failed" };
}
