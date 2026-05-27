/**
 * 주식 텔레그램 연동 점검 + 테스트 1건
 *   node scripts/probe-stock-telegram.mjs
 *   node scripts/probe-stock-telegram.mjs --send
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  getTelegramNotifyStatus,
  probeStockTelegramSetup,
  resolveStockTelegramDestinations,
  sendStockTelegramMessage,
} from "../server/telegram-notify.js";

loadEnvFile();

const doSend = process.argv.includes("--send");

const tokenOk = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim() || "";
const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || "";

console.log("TELEGRAM_BOT_TOKEN:", tokenOk ? "설정됨" : "없음");
console.log("TELEGRAM_CHANNEL_ID:", channelId ? `설정됨 (${channelId})` : "없음 → 개인 DM만 사용");
console.log("TELEGRAM_CHAT_ID:", chatId ? `설정됨 (${chatId})` : "없음");

const dest = resolveStockTelegramDestinations();
console.log("발송 대상:", dest.chatIds.length ? dest.chatIds.join(", ") : "(없음)");
console.log("앱 상태:", getTelegramNotifyStatus());

const probe = await probeStockTelegramSetup();
console.log("연결 검증:", probe.ok ? `OK @${probe.bot ?? "?"}` : probe.reason ?? "실패");

if (!probe.ok) {
  process.exit(1);
}

if (!doSend) {
  console.log("\n테스트 메시지내려면: node scripts/probe-stock-telegram.mjs --send");
  process.exit(0);
}

const ok = await sendStockTelegramMessage(
  "<b>🧪 YSTOCK 테스트</b>\n\n주식 텔레그램 알림 연동 확인입니다.",
);
console.log(ok ? "\n테스트 메시지 전송: OK" : "\n테스트 메시지 전송: 실패");
process.exit(ok ? 0 : 1);
