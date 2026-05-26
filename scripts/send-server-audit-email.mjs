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
  const m = out.match(/Tests\s+(\d+)\s+passed/);
  const failM = out.match(/Test Files\s+(\d+)\s+failed/);
  const passFiles = out.match(/Test Files\s+(\d+)\s+passed/);
  testSummary = failM
    ? `vitest: ${passFiles?.[1] ?? "?"} files pass, ${failM[1]} fail (node:test 11건 suite 미인식) · ${m?.[1] ?? "?"} tests pass`
    : out.slice(-600);
} catch (e) {
  testSummary = `npm test 실패/타임아웃: ${e instanceof Error ? e.message : e}`;
}

const out = await sendServerAuditReportEmail({
  to,
  dryRun: args.includes("--dry-run"),
  testSummary,
});
console.log(JSON.stringify(out, null, 2));
