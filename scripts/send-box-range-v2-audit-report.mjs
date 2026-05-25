#!/usr/bin/env node
/**
 * 박스권 매매 로직 점검 보고서 메일 발송
 *
 *   node scripts/send-box-range-v2-audit-report.mjs --to samron3@naver.com
 *   node scripts/send-box-range-v2-audit-report.mjs   (기본: samron3@naver.com)
 *   node scripts/send-box-range-v2-audit-report.mjs --dry-run
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_AUDIT_REPORT_TO,
  sendBoxRangeV2AuditReportEmail,
} from "../server/notifications/box-range-v2-audit-report.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_AUDIT_REPORT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

const out = await sendBoxRangeV2AuditReportEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
