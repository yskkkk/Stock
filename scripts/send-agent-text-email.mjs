#!/usr/bin/env node
/**
 * 에이전트 결과 — 본문 텍스트만 발송 (첨부 없음)
 *
 * 수신: .env AGENT_EMAIL_TO (네이버 메일)
 *
 * 사용:
 *   node scripts/send-agent-text-email.mjs "제목" < body.txt
 *   node scripts/send-agent-text-email.mjs "제목" --file report.md
 *   node scripts/send-agent-text-email.mjs "제목" "본문 한 줄"
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

function resolveAgentEmailTo() {
  return String(process.env.AGENT_EMAIL_TO ?? "").trim();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const args = process.argv.slice(2);
const subjectRaw = String(args[0] ?? "").trim();
if (!subjectRaw) {
  console.error(
    "Usage: node scripts/send-agent-text-email.mjs <subject> [--file path | body text]",
  );
  process.exit(1);
}

const to = resolveAgentEmailTo();
if (!to || !to.includes("@")) {
  console.error(
    "AGENT_EMAIL_TO not set in .env — set your Naver address (e.g. name@naver.com)",
  );
  process.exit(1);
}

if (!isEmailSendingConfigured()) {
  console.error("SMTP not configured (set SMTP_HOST in .env)");
  process.exit(1);
}

let body = "";
const fileIdx = args.indexOf("--file");
if (fileIdx >= 0) {
  const filePath = path.resolve(args[fileIdx + 1] ?? "");
  if (!filePath || !fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }
  body = fs.readFileSync(filePath, "utf8");
} else if (args.length > 1 && fileIdx < 0) {
  body = args.slice(1).join(" ");
} else if (!process.stdin.isTTY) {
  body = await readStdin();
} else {
  console.error("Provide --file, inline body, or pipe stdin");
  process.exit(1);
}

body = body.trim();
if (!body) {
  console.error("Email body is empty");
  process.exit(1);
}

const subject = subjectRaw.startsWith("[YSTOCK]")
  ? subjectRaw
  : `[YSTOCK] ${subjectRaw}`;

await sendTransactionalEmail({ to, subject, text: body });
console.log("Sent to", to, "—", subject);
