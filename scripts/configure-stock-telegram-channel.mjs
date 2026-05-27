/**
 * 주식 봇 채널 ID 찾기·검증·.env 반영
 *
 *   node scripts/configure-stock-telegram-channel.mjs
 *   node scripts/configure-stock-telegram-channel.mjs @채널username
 *   node scripts/configure-stock-telegram-channel.mjs -1003970301126 --write-env
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnvFile } from "../server/load-env.js";
import {
  normalizeStockTelegramChatId,
  sendStockTelegramMessage,
} from "../server/telegram-notify.js";

loadEnvFile();

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const writeEnv = process.argv.includes("--write-env");
const arg = process.argv.find(
  (a) => a !== "--write-env" && !a.endsWith("configure-stock-telegram-channel.mjs"),
);

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN이 .env에 없습니다.");
  process.exit(1);
}

/** @returns {Map<string, { id: string; type: string; label: string }>} */
async function discoverChats() {
  await fetch(
    `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`,
  ).catch(() => {});
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=100`,
  );
  const data = await res.json();
  if (!data.ok) {
    console.error("getUpdates 실패:", data.description ?? data);
    process.exit(1);
  }
  const map = new Map();
  for (const u of data.result ?? []) {
    const c =
      u.channel_post?.chat ??
      u.message?.chat ??
      u.my_chat_member?.chat ??
      u.chat_member?.chat;
    if (!c?.id) continue;
    const id = String(c.id);
    const label = c.title ?? c.username ?? c.first_name ?? id;
    map.set(id, { id, type: c.type, label });
  }
  return map;
}

async function probeChatId(raw) {
  const chatId = normalizeStockTelegramChatId(raw);
  if (!chatId) return { ok: false, reason: "empty id" };
  const chatRes = await fetch(
    `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
  );
  const chatBody = await chatRes.json();
  if (!chatBody?.ok) {
    return { ok: false, reason: chatBody?.description ?? "getChat failed" };
  }
  process.env.TELEGRAM_CHANNEL_ID = chatId;
  const sent = await sendStockTelegramMessage(
    "<b>✅ YSTOCK 채널 연동</b>\n\n주식 알림이 이 채널로 전송됩니다.",
  );
  return {
    ok: sent,
    chatId,
    type: chatBody.result?.type,
    title: chatBody.result?.title ?? chatBody.result?.username,
    reason: sent ? null : "sendMessage failed",
  };
}

function writeChannelToEnv(channelId) {
  let text = readFileSync(envPath, "utf8");
  const line = `TELEGRAM_CHANNEL_ID=${channelId}`;
  if (/^TELEGRAM_CHANNEL_ID=/m.test(text)) {
    text = text.replace(/^TELEGRAM_CHANNEL_ID=.*$/m, line);
  } else {
    text = text.replace(
      /^(TELEGRAM_BOT_TOKEN=.*)$/m,
      `$1\n${line}`,
    );
  }
  writeFileSync(envPath, text, "utf8");
  console.log(".env에 반영:", line);
}

let channelId = arg ? normalizeStockTelegramChatId(arg) : "";

if (!channelId) {
  const chats = await discoverChats();
  const channels = [...chats.values()].filter((c) => c.type === "channel");
  if (channels.length === 1) {
    channelId = channels[0].id;
    console.log(
      `채널 자동 선택: ${channels[0].label} (${channelId})`,
    );
  } else if (channels.length > 1) {
    console.log("채널이 여러 개입니다. 인자로 지정하세요:");
    for (const c of channels) {
      console.log(`  ${c.id}  (${c.label})`);
    }
    process.exit(1);
  } else {
    console.log(
      "채널을 찾지 못했습니다.\n" +
        "1) 텔레그램 채널에 @YSK_STOCK_RECOMMEND_BOT 을 관리자(메시지 게시)로 추가\n" +
        "2) 채널에 글 1개 게시\n" +
        "3) 이 스크립트를 다시 실행\n" +
        "또는: node scripts/configure-stock-telegram-channel.mjs @채널명 --write-env",
    );
    process.exit(1);
  }
}

const result = await probeChatId(channelId);
if (!result.ok) {
  console.error("연동 실패:", result.reason);
  process.exit(1);
}

console.log(
  `OK — ${result.title ?? "?"} (${result.type}) chat_id=${result.chatId}`,
);

if (writeEnv) {
  writeChannelToEnv(result.chatId);
} else {
  console.log(
    "\n.env에 넣으려면:\n  TELEGRAM_CHANNEL_ID=" +
      result.chatId +
      "\n또는 --write-env",
  );
}
