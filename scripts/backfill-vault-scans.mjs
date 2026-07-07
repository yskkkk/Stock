#!/usr/bin/env node
/**
 * 종목보관 스캔 누락 감사·백필
 *
 * Usage:
 *   node scripts/backfill-vault-scans.mjs --from 2026-07-06 --to 2026-07-07
 *   node scripts/backfill-vault-scans.mjs --anchor 2026-07-06 --days 7 --dry-run
 *   node scripts/backfill-vault-scans.mjs --from 2026-07-06 --only book_accum
 */
import { loadEnvFile } from "../server/load-env.js";
import { getKstParts, shiftDateKey } from "../server/kr-business-day.js";

loadEnvFile();

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || idx + 1 >= process.argv.length) return null;
  return String(process.argv[idx + 1]).trim();
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const dryRun = hasFlag("--dry-run");
const onlyComponent = readArg("--only");
const anchor = readArg("--anchor") ?? "2026-07-06";
const days = Number(readArg("--days") ?? 7);
const fromDate = readArg("--from") ?? shiftDateKey(anchor, -(Math.max(1, days) - 1));
const toDate = readArg("--to") ?? getKstParts(new Date()).dateKey;

console.log("[vault-backfill] range", { fromDate, toDate, anchor, dryRun, onlyComponent });

const { auditAndBackfillVaultScans } = await import("../server/vault-scan-backfill.js");

const out = await auditAndBackfillVaultScans({
  fromDate,
  toDate,
  dryRun,
  onlyComponent: /** @type {import("../server/vault-scan-audit.js").VaultScanComponentId | undefined} */ (
    onlyComponent ?? undefined
  ),
});

console.log("[vault-backfill] audit gapCount", out.audit.gapCount);
if (out.audit.gapCount > 0) {
  for (const gap of out.audit.gaps) {
    console.log(
      `  - ${gap.scanDate} ${gap.market} ${gap.label}`,
    );
  }
}

console.log(
  "[vault-backfill] backfill",
  JSON.stringify(
    {
      dryRun: out.backfill.dryRun,
      requested: out.backfill.requested,
      executed: out.backfill.executed,
      ok: out.backfill.ok,
      failed: out.backfill.failed.map((f) => ({
        label: f.gap.label,
        error: f.error,
      })),
    },
    null,
    2,
  ),
);

if (!dryRun && out.backfill.executed > 0) {
  try {
    const { flushScanReportEmailNow } = await import(
      "../server/notifications/scan-report-email-coalesce.js"
    );
    const emailFlush = await flushScanReportEmailNow();
    if (emailFlush.sent) {
      console.log("[vault-backfill] scan report email sent", {
        totalHits: emailFlush.totalHits,
        recipients: emailFlush.recipients?.length ?? 0,
      });
    }
  } catch (e) {
    console.warn(
      "[vault-backfill] email flush",
      e instanceof Error ? e.message : e,
    );
  }
}

if (out.backfill.failed.length) process.exitCode = 1;
