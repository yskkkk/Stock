#!/usr/bin/env node
/**
 * force-enable all-scans로 잘못 돌아간 opt-in 스캔 식별 → 폴러 재중지 → 운영자 메일
 * Usage: node scripts/reconcile-user-stopped-scans.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile } from "../server/load-env.js";
import {
  INTRADAY_POLLER_IDS,
  OPT_IN_SCAN_TASK_IDS,
  SCHEDULED_SCAN_TASKS,
  scheduledScanUserStopReason,
} from "../server/scheduled-scan-policy.js";
import {
  POLLER_CATALOG,
  readPollerOverrideMetaSync,
  setPollerRuntimeEnabled,
} from "../server/poller-registry.js";
import { sendUserStoppedScanReconcileEmail } from "../server/notifications/user-stopped-scan-reconcile-email.js";
import { resolveServerDataDir } from "../server/data-path.js";

loadEnvFile();

const dryRun = process.argv.includes("--dry-run");

/** @param {string} fp */
function readLogTextSync(fp) {
  const buf = fs.readFileSync(fp);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le");
  }
  return buf.toString("utf8");
}

/** @returns {string[]} */
function findForceEnableLogTaskIds() {
  const dir = resolveServerDataDir();
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("all-scans-run-") && f.endsWith(".log"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
  files.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  /** @type {Set<string>} */
  const forced = new Set();
  for (const fp of files.slice(0, 6)) {
    let text = "";
    try {
      text = readLogTextSync(fp);
    } catch {
      continue;
    }
    if (!text.includes("[all-scans] forced all scan flags ON")) continue;
    for (const task of SCHEDULED_SCAN_TASKS) {
      if (text.includes(`[all-scans] ${task.label} start`)) {
        forced.add(task.id);
      }
    }
  }
  return [...forced];
}

function labelForTaskId(id) {
  return SCHEDULED_SCAN_TASKS.find((t) => t.id === id)?.label ?? id;
}

/** @returns {string[]} */
function pollersToStopAgain() {
  /** @type {string[]} */
  const out = [];
  for (const id of INTRADAY_POLLER_IDS) {
    const meta = readPollerOverrideMetaSync(id);
    if (meta.enabled !== false) {
      out.push(id);
    }
  }
  return out;
}

async function main() {
  const forcedTaskIds = findForceEnableLogTaskIds();
  const incorrectlyRunScans = OPT_IN_SCAN_TASK_IDS.filter((id) => {
    if (!forcedTaskIds.includes(id)) return false;
    return scheduledScanUserStopReason(
      SCHEDULED_SCAN_TASKS.find((t) => t.id === id),
    );
  }).map(labelForTaskId);

  const pollersToStop = pollersToStopAgain();
  console.log("[reconcile] incorrectly forced scans:", incorrectlyRunScans);
  console.log("[reconcile] pollers to stop again:", pollersToStop);

  if (!dryRun) {
    for (const id of pollersToStop) {
      setPollerRuntimeEnabled(id, false, {
        stoppedBy: "user",
        stopReason: "all-scans force-enable 후 사용자 요청으로 재중지",
      });
      console.log(
        `[reconcile] stopped poller ${POLLER_CATALOG[id]?.labelKo ?? id}`,
      );
    }
  }

  const mail = await sendUserStoppedScanReconcileEmail({
    incorrectlyRunScans,
    stoppedPollers: pollersToStop,
    dryRun,
  });
  console.log(JSON.stringify({ incorrectlyRunScans, pollersToStop, mail }, null, 2));
}

main().catch((e) => {
  console.error("[reconcile] fatal", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
