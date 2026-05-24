/**
 * 서버 오프라인 화면 — OPS 텔레그램으로 기동 요청
 */
import {
  isOpsTelegramNotifyEnabled,
  resolveOpsTelegramCreds,
  sendTelegramMessage,
} from "./telegram-notify.js";

const COOLDOWN_MS = 10 * 60 * 1000;
let lastSentAt = 0;

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
    second: "2-digit",
    hour12: false,
  });
}

/**
 * @param {{ origin?: string; userAgent?: string; via?: string }} [meta]
 */
export async function notifyServerOpenRequest(meta = {}) {
  if (!isOpsTelegramNotifyEnabled()) return { ok: false, reason: "ops_telegram_off" };
  const creds = resolveOpsTelegramCreds();
  if (!creds.token || !creds.chatId) {
    return { ok: false, reason: "ops_creds_missing" };
  }

  const now = Date.now();
  if (now - lastSentAt < COOLDOWN_MS) {
    return { ok: true, skipped: true, reason: "cooldown" };
  }

  const origin = String(meta.origin ?? "").trim() || "—";
  const via = String(meta.via ?? "web").trim() || "web";
  const ua = String(meta.userAgent ?? "").trim();
  const uaShort = ua.length > 120 ? `${ua.slice(0, 117)}…` : ua;

  const lines = [
    "<b>Stock 서버 오픈 요청</b>",
    "",
    `🌐 ${escHtml(origin)}`,
    `📡 ${escHtml(via)}`,
  ];
  if (uaShort) lines.push(`📱 ${escHtml(uaShort)}`);
  lines.push("", `<i>🕐 ${kstNowLabel()} KST</i>`);

  const sent = await sendTelegramMessage(lines.join("\n"), undefined, creds);
  if (sent) lastSentAt = now;
  return sent ? { ok: true } : { ok: false, reason: "send_failed" };
}

/** @returns {{ token: string; chatId: string } | null} */
export function resolveServerOpenClientTelegramCreds() {
  const v = String(process.env.SERVER_OPEN_CLIENT_TELEGRAM ?? "1")
    .toLowerCase()
    .trim();
  if (v === "0" || v === "false" || v === "no") return null;
  const creds = resolveOpsTelegramCreds();
  if (!creds.token || !creds.chatId) return null;
  if (!isOpsTelegramNotifyEnabled()) return null;
  return creds;
}
