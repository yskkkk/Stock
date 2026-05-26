#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import {
  DEFAULT_SERVER_AUDIT_TO,
  sendServerAuditReportEmail,
} from "../server/notifications/server-audit-bug-report-email.js";

loadEnvFile();

const args = process.argv.slice(2);
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_SERVER_AUDIT_TO;
const i = args.indexOf("--to");
if (i >= 0 && args[i + 1]) to = String(args[i + 1]).trim();

let testSummary = "";
try {
  const { execSync } = await import("node:child_process");
  const out = execSync("npm test 2>&1", {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2_000_000,
  });
  const m = out.match(/Tests\s+(\d+)\s+failed[^\n]*\n[^\n]*\s+(\d+)\s+passed/);
  testSummary = m
    ? `vitest: failed ${m[1]}, passed ${m[2]} (chart-overlay flat range 1건 등)`
    : out.slice(-800);
} catch (e) {
  testSummary = `npm test 실패/타임아웃: ${e instanceof Error ? e.message : e}`;
}

const out = await sendServerAuditReportEmail({
  to,
  dryRun: args.includes("--dry-run"),
  testSummary,
});
console.log(JSON.stringify(out, null, 2));
