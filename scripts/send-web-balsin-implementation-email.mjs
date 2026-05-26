#!/usr/bin/env node
/**
 * [Web발신] 구현 방식 안내 메일
 *   node scripts/send-web-balsin-implementation-email.mjs
 *   node scripts/send-web-balsin-implementation-email.mjs --to samron3@naver.com
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_WEB_BALSIN_IMPL_TO,
  sendWebBalsinImplementationReportEmail,
} from "../server/notifications/web-balsin-implementation-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_WEB_BALSIN_IMPL_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = String(args[toIdx + 1]).trim();

const out = await sendWebBalsinImplementationReportEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
