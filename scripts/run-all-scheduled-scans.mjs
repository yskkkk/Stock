#!/usr/bin/env node
/**
 * 서버 폴러 스케줄에 등록된 종목 스캔을 즉시 1회 실행.
 * env로 꺼져 있어도 이 스크립트는 전 범위를 강제 실행(스크리너·박스권 포함).
 * 완료 후 Windows PC 자동 종료(30s, STOCK_ALL_SCANS_SHUTDOWN=0 이면 생략).
 * Usage: node scripts/run-all-scheduled-scans.mjs
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

/** 전체 스캔 SSOT — 개별 폴러 env=0 이어도 여기서 켠다 */
function forceEnableAllScheduledScans() {
  Object.assign(process.env, {
    STOCK_GOLDEN_CROSS_SCAN: "1",
    STOCK_BOTTOM_CANDLE_SCAN: "1",
    STOCK_BOOK_ACCUM_FAST_SCAN: "1",
    STOCK_BOX_RANGE_DETECT: "1",
    STOCK_KR_INVESTOR_FLOW: "1",
    STOCK_FINANCIALS_ARCHIVE: "1",
    STOCK_SHARE_STRUCTURE_SCAN: "1",
    STOCK_SCREENER_POLL: "1",
  });
  console.log("[all-scans] forced all scan flags ON");
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

async function main() {
  forceEnableAllScheduledScans();
  const startedAt = Date.now();
  console.log("[all-scans] trigger at", new Date().toISOString());

  const { runFullBottomCandleScanInternal } = await import(
    "../server/bottom-candle-poller.js"
  );
  const { runSp500BoxRangeCatalogScan } = await import(
    "../server/box-range/sp500-scan-runner.js"
  );
  const { runKrBoxRangeCatalogScan } = await import(
    "../server/box-range/kr-scan-runner.js"
  );
  const { runCryptoBoxRangeCatalogScan } = await import(
    "../server/box-range/crypto-scan-runner.js"
  );
  const { runKrInvestorFlowScan } = await import("../server/kr-investor-flow.js");
  const { runFinancialsArchiveForMarket } = await import(
    "../server/stock-financials-archive.js"
  );
  const { runShareStructureScanForMarket } = await import(
    "../server/stock-share-structure.js"
  );
  const { runScreeningOnce } = await import("../server/screener.js");

  /** @type {Promise<{ label: string; ok: boolean; durationMs: number; error?: string }>[]} */
  const tasks = [
    runTask("vault(golden-cross·정배열·120·저점기울기·매집)", runVaultScans),
    runTask("bottom-candle", () =>
      runFullBottomCandleScanInternal(new Date(), "manual"),
    ),
    runTask("book-accum-fast(kr+us)", runBookAccumFastAllMarkets),
    runTask("box-us", () => runSp500BoxRangeCatalogScan()),
    runTask("box-kr", () => runKrBoxRangeCatalogScan()),
    runTask("box-crypto", () => runCryptoBoxRangeCatalogScan()),
    runTask("kr-investor-flow", () => runKrInvestorFlowScan()),
    runTask("financials-kr", () => runFinancialsArchiveForMarket("kr")),
    runTask("financials-us", () => runFinancialsArchiveForMarket("us")),
    runTask("share-structure-kr", () => runShareStructureScanForMarket("kr")),
    runTask("share-structure-us", () => runShareStructureScanForMarket("us")),
    runTask("screener", () => runScreeningOnce()),
  ];

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
