#!/usr/bin/env node
/**
 * TradingView vs YSTOCK 박스권 차이 분석 메일
 *
 *   node scripts/send-box-range-pine-tv-email.mjs
 *   node scripts/send-box-range-pine-tv-email.mjs --to samron3@naver.com
 *   node scripts/send-box-range-pine-tv-email.mjs --dry-run
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_PINE_TV_REPORT_TO,
  sendPineTvVsYstockReportEmail,
} from "../server/notifications/box-range-pine-tv-vs-ystock-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_PINE_TV_REPORT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

const out = await sendPineTvVsYstockReportEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
