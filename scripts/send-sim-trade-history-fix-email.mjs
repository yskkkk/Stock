#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_SIM_TRADE_FIX_TO,
  sendSimTradeHistoryFixReportEmail,
} from "../server/notifications/sim-trade-history-fix-email.js";

loadEnvFile();
const args = process.argv.slice(2);
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_SIM_TRADE_FIX_TO;
const i = args.indexOf("--to");
if (i >= 0 && args[i + 1]) to = String(args[i + 1]).trim();
const out = await sendSimTradeHistoryFixReportEmail({
  to,
  dryRun: args.includes("--dry-run"),
});
console.log(JSON.stringify(out, null, 2));
