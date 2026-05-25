/**
 * 현재 카탈로그·FSM에 있는 유효 박스권 목록 메일 발송
 *
 *   node scripts/send-box-range-catalog-list-email.mjs
 *   node scripts/send-box-range-catalog-list-email.mjs --to user@example.com
 */
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_AUDIT_REPORT_TO,
  sendBoxRangeCatalogListEmail,
} from "../server/notifications/box-range-catalog-list-email.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_AUDIT_REPORT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

const out = await sendBoxRangeCatalogListEmail({ to, dryRun });
console.log(JSON.stringify(out, null, 2));
