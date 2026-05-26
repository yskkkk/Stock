#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_BOX_ALERT_WHY_TO,
  sendBoxAlertWhyNoneReportEmail,
} from "../server/notifications/box-range-alert-why-none-email.js";

loadEnvFile();

const args = process.argv.slice(2);
let to = process.env.STOCK_BOX_ALERT_WHY_TO?.trim() || DEFAULT_BOX_ALERT_WHY_TO;
const i = args.indexOf("--to");
if (i >= 0 && args[i + 1]) to = String(args[i + 1]).trim();

const out = await sendBoxAlertWhyNoneReportEmail({
  to,
  dryRun: args.includes("--dry-run"),
});
console.log(JSON.stringify(out, null, 2));
