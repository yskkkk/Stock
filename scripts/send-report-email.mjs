#!/usr/bin/env node
/**
 * Markdown 보고서를 SMTP 본문 텍스트로 발송 (첨부 없음)
 * 수신 기본: .env AGENT_EMAIL_TO
 * 사용: node scripts/send-report-email.mjs [toEmail] [filePath]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../server/load-env.js";
import {
  isEmailSendingConfigured,
  sendTransactionalEmail,
} from "../server/email-sender.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile();

const argTo = String(process.argv[2] ?? "").trim();
const argFile = process.argv[3];
const to =
  argTo && argTo.includes("@")
    ? argTo
    : String(process.env.AGENT_EMAIL_TO ?? "").trim();
const filePath = argFile
  ? path.resolve(argFile)
  : argTo && !argTo.includes("@")
    ? path.resolve(argTo)
    : path.join(__dirname, "../BUG_REPORT_BACKEND_2026-05-25.md");

if (!to || !to.includes("@")) {
  console.error(
    "Usage: node scripts/send-report-email.mjs [toEmail] [filePath] — or set AGENT_EMAIL_TO in .env",
  );
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

const body = fs.readFileSync(filePath, "utf8").trim();
const name = path.basename(filePath);
const subject = `[YSTOCK] ${name}`;

await sendTransactionalEmail({ to, subject, text: body });

console.log("Sent to", to, "—", subject, "(text body, no attachment)");
