#!/usr/bin/env node
/**
 * 서버 폴러 스케줄에 등록된 종목 스캔을 즉시 1회 실행.
 * Usage: node scripts/run-all-scheduled-scans.mjs
 */
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "../server/load-env.js";

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

async function runVaultScans() {
  const { getKstParts } = await import("../server/kr-business-day.js");
  const { runVaultMarketScans } = await import("../server/golden-cross-poller.js");
  const { goldenCrossScanEnabled } = await import("../server/golden-cross-poller.js");
  if (!goldenCrossScanEnabled()) {
    return { skipped: true, reason: "STOCK_GOLDEN_CROSS_SCAN=0" };
  }
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

async function main() {
  const startedAt = Date.now();
  console.log("[all-scans] trigger at", new Date().toISOString());

  /** @type {Promise<{ label: string; ok: boolean; durationMs: number; error?: string }>[]} */
  const tasks = [];

  tasks.push(runTask("vault(golden-cross·정배열·120·저점기울기·매집)", runVaultScans));

  const { bottomCandleScanEnabled, runFullBottomCandleScanInternal } =
    await import("../server/bottom-candle-poller.js");
  if (bottomCandleScanEnabled()) {
    tasks.push(
      runTask("bottom-candle", () =>
        runFullBottomCandleScanInternal(new Date(), "manual"),
      ),
    );
  } else {
    console.log("[all-scans] bottom-candle skip STOCK_BOTTOM_CANDLE_SCAN=0");
  }

  const { bookAccumFastScanEnabled, runBookAccumulationFastScan } =
    await import("../server/book-accumulation-fast-scan.js");
  if (bookAccumFastScanEnabled()) {
    tasks.push(
      runTask("book-accum-fast(nasdaq)", () =>
        runBookAccumulationFastScan({
          scope: "nasdaq",
          market: "us",
          scanDate: localUsDateKey(),
          mergeVault: true,
          persistState: true,
        }),
      ),
    );
  } else {
    console.log("[all-scans] book-accum-fast skip STOCK_BOOK_ACCUM_FAST_SCAN=0");
  }

  const { boxRangeDetectEnabled } = await import("../server/box-range/constants.js");
  if (boxRangeDetectEnabled()) {
    const { runSp500BoxRangeCatalogScan } = await import(
      "../server/box-range/sp500-scan-runner.js"
    );
    const { runKrBoxRangeCatalogScan } = await import(
      "../server/box-range/kr-scan-runner.js"
    );
    const { runCryptoBoxRangeCatalogScan } = await import(
      "../server/box-range/crypto-scan-runner.js"
    );
    tasks.push(runTask("box-us", () => runSp500BoxRangeCatalogScan()));
    tasks.push(runTask("box-kr", () => runKrBoxRangeCatalogScan()));
    tasks.push(runTask("box-crypto", () => runCryptoBoxRangeCatalogScan()));
  } else {
    console.log("[all-scans] box-range skip STOCK_BOX_RANGE_DETECT≠1");
  }

  const { krInvestorFlowEnabled, runKrInvestorFlowScan } = await import(
    "../server/kr-investor-flow.js"
  );
  if (krInvestorFlowEnabled()) {
    tasks.push(runTask("kr-investor-flow", () => runKrInvestorFlowScan()));
  }

  const { financialsArchiveEnabled } = await import(
    "../server/stock-financials-archive-schedule.js"
  );
  const { runFinancialsArchiveForMarket } = await import(
    "../server/stock-financials-archive.js"
  );
  if (financialsArchiveEnabled()) {
    for (const market of /** @type {const} */ (["kr", "us"])) {
      tasks.push(runTask(`financials-${market}`, () => runFinancialsArchiveForMarket(market)));
    }
  }

  const { shareStructureScanEnabled } = await import(
    "../server/stock-share-structure-schedule.js"
  );
  const { runShareStructureScanForMarket } = await import(
    "../server/stock-share-structure.js"
  );
  if (shareStructureScanEnabled()) {
    for (const market of /** @type {const} */ (["kr", "us"])) {
      tasks.push(runTask(`share-structure-${market}`, () => runShareStructureScanForMarket(market)));
    }
  }

  const { screeningPollerEnabled, runScreening } = await import("../server/screener.js");
  if (screeningPollerEnabled()) {
    tasks.push(runTask("screener", () => runScreening()));
  }

  const results = await Promise.allSettled(tasks);
  const summary = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { label: `task-${i}`, ok: false, error: String(r.reason) },
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
}

main().catch((e) => {
  console.error("[all-scans] fatal", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
