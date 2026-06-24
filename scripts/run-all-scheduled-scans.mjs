#!/usr/bin/env node
/**
 * 서버 폴러 스케줄에 등록된 종목 스캔을 즉시 1회 실행.
 * 사용자가 env·도크로 끈 스캔은 건너뛰고, 미완료·장애 복구 대상만 실행.
 * 완료 후 PC 자동 종료는 기본 OFF (--shutdown 또는 STOCK_ALL_SCANS_SHUTDOWN=1).
 * Usage: node scripts/run-all-scheduled-scans.mjs
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { loadEnvFile } from "../server/load-env.js";
import {
  listScheduledScanRecoveryPlan,
  SCHEDULED_SCAN_TASKS,
} from "../server/scheduled-scan-policy.js";

loadEnvFile();

const forceAll =
  process.argv.includes("--force") ||
  String(process.env.STOCK_ALL_SCANS_FORCE ?? "").trim() === "1";

/** 종목보관 스캔만 — 개별 폴러 env=0 이어도 강제 실행 시 켠다 */
function forceEnableAllScheduledScans() {
  Object.assign(process.env, {
    STOCK_GOLDEN_CROSS_SCAN: "1",
    STOCK_BOTTOM_CANDLE_SCAN: "1",
    STOCK_BOOK_ACCUM_FAST_SCAN: "1",
  });
  console.log("[all-scans] forced vault scan flags ON");
}

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** @param {string} label @param {() => Promise<unknown>} fn */
async function runTask(label, fn) {
  const t0 = Date.now();
  console.log(`[all-scans] ${label} start`);
  try {
    const result = await fn();
    console.log(
      `[all-scans] ${label} done ${Math.round((Date.now() - t0) / 1000)}s`,
      result != null ? JSON.stringify(result).slice(0, 400) : "",
    );
    return { label, ok: true, durationMs: Date.now() - t0 };
  } catch (e) {
    console.error(
      `[all-scans] ${label} fail`,
      e instanceof Error ? e.message : e,
    );
    return {
      label,
      ok: false,
      durationMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function scheduleShutdownAfterAllScans() {
  const enabled =
    process.argv.includes("--shutdown") ||
    String(process.env.STOCK_ALL_SCANS_SHUTDOWN ?? "0").trim() === "1";
  if (!enabled) return;
  if (process.platform === "win32") {
    console.log("[all-scans] PC shutdown in 30s (cancel: shutdown /a)");
    spawn("shutdown", ["/s", "/t", "30", "/c", "Stock all-scans finished"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  console.log("[all-scans] auto-shutdown only on Windows — skipped");
}

async function runVaultScans() {
  const { getKstParts } = await import("../server/kr-business-day.js");
  const { runVaultMarketScans } = await import("../server/golden-cross-poller.js");
  const now = new Date();
  const runId = randomUUID();
  /** @type {unknown[]} */
  const markets = [];
  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
    markets.push(
      await runVaultMarketScans(market, scanDate, runId, "manual", {
        notifyGoldenCrossTelegram: true,
        persistScanState: true,
        appendHistory: true,
      }),
    );
  }
  return { runId, markets: markets.map((m) => m?.goldenCross?.hitCount ?? 0) };
}

async function runBookAccumFastAllMarkets() {
  const { getKstParts } = await import("../server/kr-business-day.js");
  const { runBookAccumulationFastScan } = await import(
    "../server/book-accumulation-fast-scan.js"
  );
  const now = new Date();
  /** @type {unknown[]} */
  const results = [];
  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
    results.push(
      await runBookAccumulationFastScan({
        market,
        scanDate,
        mergeVault: true,
        persistState: true,
      }),
    );
  }
  return results.map((r) => ({
    market: r.market,
    scope: r.scope,
    scanned: r.scanned,
    hitCount: r.hitCount,
  }));
}

/** @param {string} taskId */
function taskRunner(taskId) {
  switch (taskId) {
    case "vault":
      return runVaultScans;
    case "bottom-candle":
      return async () => {
        const { runFullBottomCandleScanInternal } = await import(
          "../server/bottom-candle-poller.js"
        );
        return runFullBottomCandleScanInternal(new Date(), "manual");
      };
    case "book-accum-fast":
      return runBookAccumFastAllMarkets;
    default:
      return null;
  }
}

/** vault·매집 fast가 동일 vault를 쓰므로 순차 실행 */
const VAULT_SEQUENTIAL_TASK_IDS = ["vault", "book-accum-fast"];

/** @param {Array<{ id: string; label: string }>} metas */
async function runScheduledTasks(metas) {
  /** @type {Array<{ label: string; ok: boolean; durationMs: number; error?: string }>} */
  const summary = [];
  const sequential = metas.filter((m) => VAULT_SEQUENTIAL_TASK_IDS.includes(m.id));
  const parallel = metas.filter((m) => !VAULT_SEQUENTIAL_TASK_IDS.includes(m.id));

  for (const meta of sequential) {
    const fn = taskRunner(meta.id);
    if (!fn) continue;
    summary.push(await runTask(meta.label, fn));
  }

  if (parallel.length) {
    const results = await Promise.allSettled(
      parallel.map((meta) => {
        const fn = taskRunner(meta.id);
        if (!fn) return Promise.resolve({ label: meta.label, ok: false, error: "no-runner" });
        return runTask(meta.label, fn);
      }),
    );
    for (const r of results) {
      summary.push(
        r.status === "fulfilled"
          ? r.value
          : { label: "parallel-task", ok: false, error: String(r.reason) },
      );
    }
  }

  return summary;
}

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  console.log("[all-scans] trigger at", now.toISOString());

  const taskById = new Map(SCHEDULED_SCAN_TASKS.map((t) => [t.id, t]));
  /** @type {Array<{ id: string; label: string }>} */
  let metas = [];

  if (forceAll) {
    forceEnableAllScheduledScans();
    console.log("[all-scans] force mode — vault scheduled tasks only");
    metas = SCHEDULED_SCAN_TASKS.map((t) => ({ id: t.id, label: t.label }));
  } else {
    console.log("[all-scans] recovery mode — user-stopped scans are skipped");
    const plan = await listScheduledScanRecoveryPlan(now);
    for (const row of plan) {
      if (row.run) continue;
      console.log(
        `[all-scans] skip ${row.label} (${row.stopReason ?? "skip"})`,
      );
    }
    for (const row of plan) {
      if (!row.run) continue;
      const meta = taskById.get(row.id);
      if (!meta) continue;
      metas.push({ id: meta.id, label: meta.label });
    }
  }

  if (!metas.length) {
    console.log("[all-scans] nothing to run");
    return;
  }

  const summary = await runScheduledTasks(metas);
  try {
    const { flushScanReportEmailNow } = await import(
      "../server/notifications/scan-report-email-coalesce.js"
    );
    const emailFlush = await flushScanReportEmailNow();
    if (emailFlush.sent) {
      console.log("[all-scans] scan report email sent", {
        totalHits: emailFlush.totalHits,
        recipients: emailFlush.recipients?.length ?? 0,
      });
    }
  } catch (e) {
    console.warn(
      "[all-scans] scan report email flush",
      e instanceof Error ? e.message : e,
    );
  }
  console.log(
    "[all-scans] finished",
    JSON.stringify(
      {
        elapsedMs: Date.now() - startedAt,
        summary,
      },
      null,
      2,
    ),
  );
  scheduleShutdownAfterAllScans();
}

main().catch((e) => {
  console.error("[all-scans] fatal", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
