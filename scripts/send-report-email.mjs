#!/usr/bin/env node
/**
 * Markdown 보고서를 SMTP로 발송 (첨부 + 본문 요약)
 * 사용: node scripts/send-report-email.mjs <toEmail> <filePath>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { loadEnvFile } from "../server/load-env.js";
import { isEmailSendingConfigured, resolveMailFrom } from "../server/email-sender.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile();

const to = String(process.argv[2] ?? "").trim();
const fileArg = process.argv[3];
const filePath = fileArg
  ? path.resolve(fileArg)
  : path.join(__dirname, "../BUG_REPORT_BACKEND_2026-05-25.md");

if (!to || !to.includes("@")) {
  console.error("Usage: node scripts/send-report-email.mjs <toEmail> [filePath]");
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error("File not found:", filePath);
  process.exit(1);
}
if (!isEmailSendingConfigured()) {
  console.error("SMTP not configured (set SMTP_HOST in .env)");
  process.exit(1);
}
if (process.env.EMAIL_VERIFY_MOCK === "1") {
  console.error("EMAIL_VERIFY_MOCK=1 — real send disabled");
  process.exit(1);
}

const body = fs.readFileSync(filePath, "utf8");
const name = path.basename(filePath);
const host = String(process.env.SMTP_HOST ?? "").trim();
const port = Number(process.env.SMTP_PORT ?? 587);
const secure = process.env.SMTP_SECURE === "1" || port === 465;
const user = String(process.env.SMTP_USER ?? "").trim();
const pass = String(process.env.SMTP_PASS ?? "");
const from = resolveMailFrom();
const replyTo = String(process.env.SMTP_REPLY_TO ?? "").trim();

const transport = nodemailer.createTransport({
  host,
  port: Number.isFinite(port) ? port : 587,
  secure,
  auth: user ? { user, pass } : undefined,
});

const subject = `[YSTOCK] ${name}`;
const preview = body.split("\n").slice(0, 12).join("\n");

await transport.sendMail({
  from: { name: from.name, address: from.address },
  ...(replyTo ? { replyTo } : {}),
  to,
  subject,
  text:
    `첨부: ${name}\n\n` +
    `--- 미리보기 ---\n${preview}\n\n…(전문은 첨부 파일)\n`,
  attachments: [
    {
      filename: name,
      content: body,
      contentType: "text/markdown; charset=utf-8",
    },
  ],
});

console.log("Sent to", to, "—", name);
