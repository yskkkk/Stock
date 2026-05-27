#!/usr/bin/env node
/**
 * pine-box-range-pro-v2-ma 실매 vs 차트 분석 메일
 * node scripts/send-live-vs-chart-email.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";

loadEnvFile();

const TO = "samron3797@gmail.com";
const dir = dirname(fileURLToPath(import.meta.url));
const mdPath = join(dir, "pine-box-range-pro-v2-ma-LIVE-vs-CHART-EMAIL.md");
const md = readFileSync(mdPath, "utf8");
const ts = new Date().toISOString().slice(0, 16).replace("T", " ");

const text = md.replace(/^# /gm, "").replace(/\*\*/g, "");

const htmlBody = md
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/^### (.+)$/gm, "<h3 style='color:#a0b8d8;margin:16px 0 8px'>$1</h3>")
  .replace(/^## (.+)$/gm, "<h2 style='color:#7eb8f7;margin:20px 0 10px;border-left:3px solid #3a6a9c;padding-left:10px'>$1</h2>")
  .replace(/^# (.+)$/gm, "<h1 style='color:#7eb8f7;font-size:18px'>$1</h1>")
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/^- (.+)$/gm, "<li style='margin:4px 0'>$1</li>")
  .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul style='margin:8px 0;padding-left:20px'>${m}</ul>`)
  .replace(/`([^`]+)`/g, "<code style='background:#1a2235;padding:1px 4px;border-radius:3px'>$1</code>")
  .replace(/\n\n/g, "<br><br>")
  .replace(/\n/g, "<br>");

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Arial,sans-serif;background:#0f0f14;color:#e0e0e0;padding:20px;font-size:13px;line-height:1.55;max-width:720px">
<p style="color:#5a7a9a;font-size:11px">YSTOCK · ${ts}</p>
${htmlBody}
<p style="color:#5a7a9a;font-size:11px;margin-top:24px">투자 권유가 아닌 로직 설명입니다.</p>
</body></html>`;

const subject = `[YSTOCK] 박스권 V2+MA — 실매 vs 차트 수익률 분석 (${ts})`;

if (!isEmailSendingConfigured()) {
  console.error("SMTP 미설정 — .env에 SMTP_HOST 등 확인");
  process.exit(1);
}

await sendTransactionalEmail({ to: TO, subject, text, html });
console.log(`✓ 전송 완료 → ${TO}`);
