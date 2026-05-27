/**
 * 텔레그램 chat_id 조회 — .env 토큰으로 getUpdates에 찍힌 채팅 목록 출력
 *
 * 사용:
 *   node scripts/telegram-list-chat-ids.mjs ops
 *   node scripts/telegram-list-chat-ids.mjs stock
 *
 * ops/stock 방에서 해당 봇에게 메시지를 한 번 보낸 뒤 실행하세요.
 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const which = (process.argv[2] || "ops").toLowerCase();
const token =
  which === "stock"
    ? process.env.TELEGRAM_BOT_TOKEN?.trim()
    : process.env.TELEGRAM_OPS_BOT_TOKEN?.trim();
const envKey =
  which === "stock" ? "TELEGRAM_CHANNEL_ID 또는 TELEGRAM_CHAT_ID" : "TELEGRAM_OPS_CHAT_ID";

if (!token) {
  console.error(
    which === "stock"
      ? "TELEGRAM_BOT_TOKEN이 .env에 없습니다."
      : "TELEGRAM_OPS_BOT_TOKEN이 .env에 없습니다.",
  );
  process.exit(1);
}

const res = await fetch(
  `https://api.telegram.org/bot${token}/getUpdates?limit=50`,
);
const data = await res.json();
if (!data.ok) {
  console.error("Telegram API 오류:", data.description ?? data);
  process.exit(1);
}

/** @type {Map<number, { id: number; type: string; label: string }>} */
const chats = new Map();
for (const u of data.result ?? []) {
  const c =
    u.message?.chat ??
    u.channel_post?.chat ??
    u.my_chat_member?.chat ??
    u.edited_message?.chat;
  if (!c?.id) continue;
  const label =
    c.title ??
    ([c.first_name, c.last_name].filter(Boolean).join(" ") ||
      c.username ||
      String(c.id));
  chats.set(c.id, { id: c.id, type: c.type, label });
}

console.log(`\n봇: ${which} (${envKey})\n`);
if (chats.size === 0) {
  console.log(
    "최근 대화가 없습니다.\n" +
      "1) 알림 받을 그룹/1:1에 봇을 넣고\n" +
      "2) 그 방에서 봇에게 아무 메시지나 보낸 뒤\n" +
      "3) 이 스크립트를 다시 실행하세요.\n",
  );
  process.exit(0);
}

for (const { id, type, label } of chats.values()) {
  const hint =
    which === "stock" && type === "channel"
      ? " → .env TELEGRAM_CHANNEL_ID"
      : which === "stock" && (type === "private" || type === "group")
        ? " → .env TELEGRAM_CHAT_ID (또는 채널은 TELEGRAM_CHANNEL_ID)"
        : "";
  console.log(`  chat_id=${id}   (${type}: ${label})${hint}`);
}
console.log(
  which === "stock"
    ? "\n채널 알림: TELEGRAM_CHANNEL_ID=-100… (봇을 채널 관리자·메시지 게시 권한)\n개인 DM만: TELEGRAM_CHAT_ID\n서버 재시작 후 적용.\n"
    : "\n원하는 방의 숫자를 .env에 넣고 서버를 재시작하세요.\n",
);
