#!/usr/bin/env node
/**
 * 박스권 1h·4h·1d 매매 전략 상세 보고서 메일
 *   node scripts/send-box-range-tf-strategy-report.mjs --to samron3@naver.com
 *   node scripts/send-box-range-tf-strategy-report.mjs --dry-run
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_BOX_RANGE_TF_REPORT_TO,
  sendBoxRangeTfStrategyReportEmail,
} from "../server/notifications/box-range-tf-strategy-report-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_BOX_RANGE_TF_REPORT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();

const result = await sendBoxRangeTfStrategyReportEmail({ to, dryRun });
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
