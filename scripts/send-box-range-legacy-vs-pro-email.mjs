#!/usr/bin/env node
/**
 * Legacy vs PRO v2 박스권 차이 보고서 메일
 *   node scripts/send-box-range-legacy-vs-pro-email.mjs --to samron3@naver.com
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_LEGACY_VS_PRO_TO,
  sendBoxRangeLegacyVsProReportEmail,
} from "../server/notifications/box-range-legacy-vs-pro-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_LEGACY_VS_PRO_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();

const result = await sendBoxRangeLegacyVsProReportEmail({ to, dryRun });
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
