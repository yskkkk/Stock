#!/usr/bin/env node
/**
 * 서버 폴러 스케줄에 등록된 종목 스캔을 즉시 1회 실행.
 * 사용자가 env·도크로 끈 스캔은 건너뛰고, 미완료·장애 복구 대상만 실행.
 * 완료 후 Windows PC 자동 종료(30s, STOCK_ALL_SCANS_SHUTDOWN=0 이면 생략).
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
  if (String(process.env.STOCK_ALL_SCANS_SHUTDOWN ?? "1").trim() === "0") {
    console.log("[all-scans] shutdown skipped STOCK_ALL_SCANS_SHUTDOWN=0");
    return;
  }
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
        scope: market === "kr" ? "sp500" : "nasdaq",
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
    case "box-us":
      return async () => {
        const { runSp500BoxRangeCatalogScan } = await import(
          "../server/box-range/sp500-scan-runner.js"
        );
        return runSp500BoxRangeCatalogScan();
      };
    case "box-kr":
      return async () => {
        const { runKrBoxRangeCatalogScan } = await import(
          "../server/box-range/kr-scan-runner.js"
        );
        return runKrBoxRangeCatalogScan();
      };
    case "box-crypto":
      return async () => {
        const { runCryptoBoxRangeCatalogScan } = await import(
          "../server/box-range/crypto-scan-runner.js"
        );
        return runCryptoBoxRangeCatalogScan();
      };
    case "kr-investor-flow":
      return async () => {
        const { runKrInvestorFlowScan } = await import(
          "../server/kr-investor-flow.js"
        );
        return runKrInvestorFlowScan();
      };
    case "financials-kr":
      return async () => {
        const { runFinancialsArchiveForMarket } = await import(
          "../server/stock-financials-archive.js"
        );
        return runFinancialsArchiveForMarket("kr");
      };
    case "financials-us":
      return async () => {
        const { runFinancialsArchiveForMarket } = await import(
          "../server/stock-financials-archive.js"
        );
        return runFinancialsArchiveForMarket("us");
      };
    case "share-structure-kr":
      return async () => {
        const { runShareStructureScanForMarket } = await import(
          "../server/stock-share-structure.js"
        );
        return runShareStructureScanForMarket("kr");
      };
    case "share-structure-us":
      return async () => {
        const { runShareStructureScanForMarket } = await import(
          "../server/stock-share-structure.js"
        );
        return runShareStructureScanForMarket("us");
      };
    case "screener":
      return async () => {
        const { runScreeningOnce } = await import("../server/screener.js");
        return runScreeningOnce();
      };
    default:
      return null;
  }
}

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  console.log("[all-scans] trigger at", now.toISOString());
  console.log("[all-scans] recovery mode — user-stopped scans are skipped");

  const plan = await listScheduledScanRecoveryPlan(now);
  for (const row of plan) {
    if (row.run) continue;
    console.log(
      `[all-scans] skip ${row.label} (${row.stopReason ?? "skip"})`,
    );
  }

  const taskById = new Map(SCHEDULED_SCAN_TASKS.map((t) => [t.id, t]));
  /** @type {Promise<{ label: string; ok: boolean; durationMs: number; error?: string }>[]} */
  const tasks = [];

  for (const row of plan) {
    if (!row.run) continue;
    const meta = taskById.get(row.id);
    const fn = taskRunner(row.id);
    if (!meta || !fn) continue;
    tasks.push(runTask(meta.label, fn));
  }

  if (!tasks.length) {
    console.log("[all-scans] nothing to recover — all scans skipped or complete");
    return;
  }

  const results = await Promise.allSettled(tasks);
  const summary = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { label: `task-${i}`, ok: false, error: String(r.reason) },
  );
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
