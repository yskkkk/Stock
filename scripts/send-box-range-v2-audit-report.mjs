#!/usr/bin/env node
/**
 * 박스권 v2 점검 보고서 메일 발송
 *
 *   node scripts/send-box-range-v2-audit-report.mjs --to you@example.com
 *   node scripts/send-box-range-v2-audit-report.mjs --dry-run
 *
 * 수신 기본값: STOCK_AUDIT_REPORT_TO 환경변수
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendBoxRangeV2AuditReportEmail } from "../server/notifications/box-range-v2-audit-report.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() ?? "";
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

if (!to) {
  console.error(
    "Usage: node scripts/send-box-range-v2-audit-report.mjs --to <email> [--dry-run]",
  );
  process.exit(1);
}

const out = await sendBoxRangeV2AuditReportEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
