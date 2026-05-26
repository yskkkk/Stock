#!/usr/bin/env node
/**
 * PRO v2 모델 검증·버그 리포트 메일
 *   node scripts/send-box-range-pro-v2-audit-report.mjs --to samron3@naver.com
 *   node scripts/send-box-range-pro-v2-audit-report.mjs --dry-run
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_PRO_V2_AUDIT_TO,
  sendBoxRangeProV2AuditReportEmail,
} from "../server/notifications/box-range-pro-v2-audit-report.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_PRO_V2_AUDIT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

const out = await sendBoxRangeProV2AuditReportEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
