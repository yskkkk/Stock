/**
 * 종목보관 스캔 누락 백필 — 감사 결과 기준 선택 재실행
 */
import { randomUUID } from "node:crypto";
import { runBottomCandleMarketScan } from "./bottom-candle-scan.js";
import {
  runBookAccumulationFastScan,
  BOOK_ACCUM_FAST_TIMEFRAMES,
} from "./book-accumulation-fast-scan.js";
import { runVaultMarketScans } from "./golden-cross-poller.js";
import {
  clearBottomCandleVaultItemsSync,
  mergeBottomCandleHitsIntoVaultSync,
} from "./stock-vault-store.js";
import {
  assessScanVaultMerge,
  applyVaultScanMerge,
} from "./scan-vault-merge.js";
import { vaultScanProgressReporter } from "./vault-scan-progress.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import {
  auditVaultScanRange,
  filterVaultScanGaps,
  groupGapsByDate,
} from "./vault-scan-audit.js";

const VAULT_BATCH_COMPONENTS = new Set([
  "golden_cross",
  "ma_align",
  "ma120_near",
  "low_slope_flip",
  "book_accum",
]);

/**
 * @param {import("./vault-scan-audit.js").VaultScanGap[]} batch
 * @param {string} runId
 */
async function runVaultBatchForDate(batch, runId) {
  const { market, scanDate } = batch[0];
  console.log(
    `[vault-backfill] vault batch ${market} ${scanDate} (${batch.map((g) => g.label).join(", ")})`,
  );
  try {
    const result = await runVaultMarketScans(market, scanDate, runId, "manual", {
      notifyGoldenCrossTelegram: false,
      persistScanState: true,
      appendHistory: true,
    });
    liveTradeLogInfo("[vault-scan:backfill] vault batch done", {
      runId,
      market,
      scanDate,
      goldenCross: result.goldenCross?.hitCount,
      bookAccum: result.bookAccum?.hitCount,
    });
    return {
      kind: "vault_batch",
      market,
      scanDate,
      ok: true,
      gaps: batch,
      hitCounts: {
        goldenCross: result.goldenCross?.hitCount ?? 0,
        maAlign: result.maAlign?.hitCount ?? 0,
        ma120Near: result.ma120Near?.hitCount ?? 0,
        bookAccum: result.bookAccum?.hitCount ?? 0,
        lowSlope: result.lowSlope?.hitCount ?? 0,
      },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[vault-scan:backfill] vault batch fail", market, scanDate, error);
    return {
      kind: "vault_batch",
      market,
      scanDate,
      ok: false,
      gaps: batch,
      error,
    };
  }
}

/**
 * @param {import("./vault-scan-audit.js").VaultScanGap} gap
 * @param {string} runId
 */
async function runBottomCandleGap(gap, runId) {
  const { market, scanDate, timeframe = "1d" } = gap;
  console.log(`[vault-backfill] bottom_candle ${market} ${scanDate} ${timeframe}`);
  try {
    const scan = await runBottomCandleMarketScan(market, scanDate, {
      persistState: true,
      timeframe,
      onProgress: vaultScanProgressReporter("bottom_candle", market, timeframe),
    });
    applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: scan.scanned,
        hitCount: scan.hitCount,
      }),
      {
        clear: () => clearBottomCandleVaultItemsSync({ market, timeframe }),
        merge: (hits) =>
          mergeBottomCandleHitsIntoVaultSync(/** @type {typeof scan.hits} */ (hits)),
      },
      scan.hits,
    );
    liveTradeLogInfo("[vault-scan:backfill] bottom_candle done", {
      runId,
      market,
      scanDate,
      timeframe,
      hitCount: scan.hitCount,
    });
    return { kind: "bottom_candle", gap, ok: true, hitCount: scan.hitCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[vault-scan:backfill] bottom_candle fail", error);
    return { kind: "bottom_candle", gap, ok: false, error };
  }
}

/**
 * @param {import("./vault-scan-audit.js").VaultScanGap} gap
 * @param {string} runId
 */
async function runBookAccumFastGap(gap, runId) {
  const { market, scanDate } = gap;
  console.log(`[vault-backfill] book_accum_fast ${market} ${scanDate}`);
  try {
    const scan = await runBookAccumulationFastScan({
      market,
      scanDate,
      timeframes: [...BOOK_ACCUM_FAST_TIMEFRAMES],
      mergeVault: true,
      persistState: true,
    });
    liveTradeLogInfo("[vault-scan:backfill] book_accum_fast done", {
      runId,
      market,
      scanDate,
      hitCount: scan.hitCount,
    });
    return { kind: "book_accum_fast", gap, ok: true, hitCount: scan.hitCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[vault-scan:backfill] book_accum_fast fail", error);
    return { kind: "book_accum_fast", gap, ok: false, error };
  }
}

/**
 * @param {import("./vault-scan-audit.js").VaultScanGap} gap
 * @param {string} runId
 */
async function runBookAccumGap(gap, runId) {
  const { runBookAccumulationMarketScan } = await import("./book-accumulation-scan.js");
  const {
    clearBookAccumVaultItemsSync,
    mergeBookAccumHitsIntoVaultSync,
  } = await import("./stock-vault-store.js");
  const { market, scanDate, timeframe = "1d" } = gap;
  console.log(`[vault-backfill] book_accum ${market} ${scanDate} ${timeframe}`);
  try {
    const scan = await runBookAccumulationMarketScan(market, scanDate, {
      persistState: true,
      timeframe,
      onProgress: vaultScanProgressReporter("book_accum", market, timeframe),
    });
    applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: scan.scanned,
        hitCount: scan.hitCount,
        errors: scan.errors ?? 0,
      }),
      {
        clear: () => clearBookAccumVaultItemsSync({ market, timeframe }),
        merge: (hits) =>
          mergeBookAccumHitsIntoVaultSync(/** @type {typeof scan.hits} */ (hits)),
      },
      scan.hits,
    );
    return { kind: "book_accum", gap, ok: true, hitCount: scan.hitCount };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    liveTradeLogWarn("[vault-scan:backfill] book_accum fail", error);
    return { kind: "book_accum", gap, ok: false, error };
  }
}

/**
 * @param {import("./vault-scan-audit.js").VaultScanGap[]} gaps
 * @param {{ dryRun?: boolean; onlyComponent?: import("./vault-scan-audit.js").VaultScanComponentId }} [opts]
 */
export async function runVaultScanBackfill(gaps, opts = {}) {
  const dryRun = opts.dryRun === true;
  const onlyComponent = opts.onlyComponent ?? null;
  const runId = randomUUID();
  /** @type {unknown[]} */
  const results = [];

  const grouped = groupGapsByDate(gaps);
  const keys = Object.keys(grouped).sort();

  for (const key of keys) {
    const batch = grouped[key];
    const vaultGaps = batch.filter((g) => VAULT_BATCH_COMPONENTS.has(g.component));
    const bottomGaps = batch.filter((g) => g.component === "bottom_candle");
    const fastGaps = batch.filter((g) => g.component === "book_accum_fast");
    const bookGaps = batch.filter((g) => g.component === "book_accum");

    if (dryRun) {
      console.log(
        `[vault-backfill] ${key} — vault:${vaultGaps.length} bottom:${bottomGaps.length} fast:${fastGaps.length}`,
      );
      continue;
    }

    if (onlyComponent === "book_accum") {
      for (const gap of bookGaps) {
        results.push(await runBookAccumGap(gap, runId));
      }
      continue;
    }
    if (onlyComponent === "bottom_candle") {
      for (const gap of bottomGaps) {
        results.push(await runBottomCandleGap(gap, runId));
      }
      continue;
    }
    if (onlyComponent === "book_accum_fast") {
      for (const gap of fastGaps) {
        results.push(await runBookAccumFastGap(gap, runId));
      }
      continue;
    }

    if (vaultGaps.length) {
      results.push(await runVaultBatchForDate(vaultGaps, runId));
    }
    for (const gap of bottomGaps) {
      results.push(await runBottomCandleGap(gap, runId));
    }
    for (const gap of fastGaps) {
      results.push(await runBookAccumFastGap(gap, runId));
    }
  }

  const failed = results.filter((r) => r && typeof r === "object" && "ok" in r && !r.ok);

  return {
    runId,
    dryRun,
    requested: gaps.length,
    executed: results.length,
    ok: results.length - failed.length,
    failed,
    results,
  };
}

/**
 * @param {{ fromDate: string; toDate: string; onlyComponent?: import("./vault-scan-audit.js").VaultScanComponentId; dryRun?: boolean; markets?: Array<"kr"|"us"> }} opts
 */
export async function auditAndBackfillVaultScans(opts) {
  const audit = auditVaultScanRange({
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    markets: opts.markets,
  });
  const gaps = filterVaultScanGaps(audit.gaps, opts.onlyComponent);
  const backfill = await runVaultScanBackfill(gaps, {
    dryRun: opts.dryRun,
    onlyComponent: opts.onlyComponent,
  });
  return { audit: { ...audit, gaps }, backfill };
}
