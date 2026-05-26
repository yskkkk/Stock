#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_SERVER_PINE_PORT_TO,
  sendServerPinePortReportEmail,
} from "../server/notifications/box-range-server-pine-port-email.js";

loadEnvFile();

const args = process.argv.slice(2);
let to = process.env.STOCK_SERVER_PINE_PORT_TO?.trim() || DEFAULT_SERVER_PINE_PORT_TO;
const i = args.indexOf("--to");
if (i >= 0 && args[i + 1]) to = String(args[i + 1]).trim();

const out = await sendServerPinePortReportEmail({
  to,
  dryRun: args.includes("--dry-run"),
});
console.log(JSON.stringify(out, null, 2));
