#!/usr/bin/env node
/**
 * 종목보관 스캔 누락 진단·백필 — 특정 scanDate 기준 vault·바닥캔들 재실행
 * Usage:
 *   node scripts/run-vault-scan-backfill.mjs --check --from 2026-07-01 --to 2026-07-06
 *   node scripts/run-vault-scan-backfill.mjs --from 2026-07-06 --to 2026-07-06
 *   node scripts/run-vault-scan-backfill.mjs --date 2026-07-03 --types vault,bottom-candle
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { loadEnvFile } from "../server/load-env.js";
import { resolveServerDataDir } from "../server/data-path.js";
import { isKrBusinessDay, shiftDateKey } from "../server/kr-business-day.js";
import { getGoldenCrossScanStateSync } from "../server/golden-cross-scan.js";
import { getMaAlignScanStateSync } from "../server/ma-align-scan.js";
import { getMa120NearScanStateSync } from "../server/ma120-near-scan.js";
import { getBookAccumulationScanStateSync } from "../server/book-accumulation-scan.js";
import { getCandleLowSlopeScanStateSync } from "../server/candle-low-slope-scan.js";
import { getBottomCandleScanStateSync } from "../server/bottom-candle-scan.js";
import { VAULT_SCAN_TIMEFRAMES } from "../server/vault-scan-timeframe.js";

loadEnvFile();

/** @typedef {"vault"|"bottom-candle"} BackfillType */

/** @type {Record<string, { label: string; state: () => { lastRuns?: unknown[] }; applies: (tf: string) => boolean }>} */
const VAULT_CHECKS = {
  golden_cross: {
    label: "golden_cross",
    state: getGoldenCrossScanStateSync,
    applies: () => true,
  },
  ma_align: {
    label: "ma_align",
    state: getMaAlignScanStateSync,
    applies: () => true,
  },
  ma120_near: {
    label: "ma120_near",
    state: getMa120NearScanStateSync,
    applies: (tf) => tf === "1d",
  },
  book_accum: {
    label: "book_accum",
    state: getBookAccumulationScanStateSync,
    applies: () => true,
  },
  low_slope_flip: {
    label: "low_slope_flip",
    state: getCandleLowSlopeScanStateSync,
    applies: (tf) => tf === "1wk",
  },
};

/**
 * @param {{ lastRuns?: Array<{ market?: string; scanDate?: string; timeframe?: string }> }} state
 * @param {"kr"|"us"} market
 * @param {string} dateKey
 * @param {string} timeframe
 * @param {{ weeklyOnly?: boolean }} [opts]
 */
function wasVaultRunRecordedSync(state, market, dateKey, timeframe, opts = {}) {
  const runs = Array.isArray(state.lastRuns) ? state.lastRuns : [];
  return runs.some((r) => {
    if (r?.market !== market || r?.scanDate !== dateKey) return false;
    if (r?.timeframe === timeframe) return true;
    if (!r?.timeframe && timeframe === "1d" && !opts.weeklyOnly) return true;
    if (!r?.timeframe && timeframe === "1wk" && opts.weeklyOnly) return true;
    return false;
  });
}

function parseArg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** @param {string} dateKey */
function isUsWeekend(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * @param {string} from
 * @param {string} to
 */
function listKrBusinessDays(from, to) {
  /** @type {string[]} */
  const out = [];
  let cur = from;
  for (let guard = 0; guard < 400 && cur <= to; guard++) {
    if (isKrBusinessDay(cur)) out.push(cur);
    cur = shiftDateKey(cur, 1);
  }
  return out;
}

/**
 * @param {string} dateKey
 * @param {"kr"|"us"} market
 */
function wasBottomCandleScannedSync(market, dateKey, timeframe) {
  const st = getBottomCandleScanStateSync();
  const runs = Array.isArray(st.lastRuns) ? st.lastRuns : [];
  return runs.some(
    (r) =>
      r?.market === market &&
      r?.scanDate === dateKey &&
      (r?.timeframe === timeframe || (!r?.timeframe && timeframe === "1d")),
  );
}

/**
 * @param {string} dateKey
 * @param {BackfillType[]} types
 */
function findMissingForDate(dateKey, types) {
  /** @type {Array<{ type: BackfillType; market: "kr"|"us"; detail?: string }>} */
  const missing = [];

  if (types.includes("vault")) {
    for (const market of /** @type {const} */ (["kr", "us"])) {
      if (market === "kr" && !isKrBusinessDay(dateKey)) continue;
      if (market === "us" && isUsWeekend(dateKey)) continue;
      for (const tf of VAULT_SCAN_TIMEFRAMES) {
        for (const check of Object.values(VAULT_CHECKS)) {
          if (!check.applies(tf)) continue;
          const st = check.state();
          if (!wasVaultRunRecordedSync(st, market, dateKey, tf, {
            weeklyOnly: check.label === "low_slope_flip",
          })) {
            missing.push({
              type: "vault",
              market,
              detail: `${check.label}/${tf}`,
            });
          }
        }
      }
    }
  }

  if (types.includes("bottom-candle")) {
    for (const market of /** @type {const} */ (["kr", "us"])) {
      if (market === "kr" && !isKrBusinessDay(dateKey)) continue;
      if (market === "us" && isUsWeekend(dateKey)) continue;
      for (const tf of VAULT_SCAN_TIMEFRAMES) {
        if (!wasBottomCandleScannedSync(market, dateKey, tf)) {
          missing.push({ type: "bottom-candle", market, detail: tf });
        }
      }
    }
  }

  return missing;
}

/**
 * @param {string} from
 * @param {string} to
 * @param {BackfillType[]} types
 */
function collectMissing(from, to, types) {
  const days = listKrBusinessDays(from, to);
  /** @type {Array<{ date: string; missing: ReturnType<typeof findMissingForDate> }>} */
  const rows = [];
  for (const date of days) {
    const missing = findMissingForDate(date, types);
    if (missing.length) rows.push({ date, missing });
  }
  return rows;
}

/** @param {string} dateKey @param {"kr"|"us"} market */
async function runVaultBackfill(dateKey, market) {
  const { runVaultMarketScans } = await import("../server/golden-cross-poller.js");
  const runId = randomUUID();
  console.log(`[backfill] vault ${market} scanDate=${dateKey}`);
  const t0 = Date.now();
  const result = await runVaultMarketScans(market, dateKey, runId, "manual", {
    notifyGoldenCrossTelegram: false,
    persistScanState: true,
    appendHistory: true,
  });
  console.log(
    `[backfill] vault ${market} done ${Math.round((Date.now() - t0) / 1000)}s`,
    {
      goldenCross: result.goldenCross?.hitCount ?? 0,
      maAlign: result.maAlign?.hitCount ?? 0,
      ma120Near: result.ma120Near?.hitCount ?? 0,
      lowSlope: result.lowSlope?.hitCount ?? 0,
      bookAccum: result.bookAccum?.hitCount ?? 0,
    },
  );
}

/** @param {string} dateKey @param {"kr"|"us"} market @param {string} timeframe */
async function runBottomCandleBackfill(dateKey, market, timeframe) {
  const { runBottomCandleMarketScan } = await import("../server/bottom-candle-scan.js");
  const {
    assessScanVaultMerge,
    applyVaultScanMerge,
  } = await import("../server/scan-vault-merge.js");
  const {
    clearBottomCandleVaultItemsSync,
    mergeBottomCandleHitsIntoVaultSync,
  } = await import("../server/stock-vault-store.js");

  console.log(`[backfill] bottom-candle ${market} ${timeframe} scanDate=${dateKey}`);
  const t0 = Date.now();
  const result = await runBottomCandleMarketScan(market, dateKey, {
    timeframe,
    persistState: true,
  });
  applyVaultScanMerge(
    assessScanVaultMerge({
      scanned: result.scanned,
      hitCount: result.hitCount,
      errors: result.errors ?? 0,
    }),
    {
      clear: () => clearBottomCandleVaultItemsSync({ market, timeframe }),
      merge: (hits) =>
        mergeBottomCandleHitsIntoVaultSync(/** @type {typeof result.hits} */ (hits)),
    },
    result.hits,
  );
  console.log(
    `[backfill] bottom-candle ${market} ${timeframe} done ${Math.round((Date.now() - t0) / 1000)}s hits=${result.hitCount}`,
  );
}

/**
 * @param {string} dateKey
 * @param {ReturnType<typeof findMissingForDate>} missing
 */
async function runBackfillForDate(dateKey, missing) {
  const needsVault = missing.some((m) => m.type === "vault");
  const bottomRows = missing.filter((m) => m.type === "bottom-candle");

  if (needsVault) {
    for (const market of /** @type {const} */ (["kr", "us"])) {
      const marketMissing = missing.some(
        (m) => m.type === "vault" && m.market === market,
      );
      if (!marketMissing) continue;
      await runVaultBackfill(dateKey, market);
    }
  }

  for (const row of bottomRows) {
    const tf = row.detail === "1wk" ? "1wk" : "1d";
    await runBottomCandleBackfill(dateKey, row.market, tf);
  }
}

async function main() {
  const checkOnly = hasFlag("--check");
  const singleDate = parseArg("--date");
  const from = parseArg("--from") ?? singleDate ?? localUsDateKey();
  const to = parseArg("--to") ?? singleDate ?? from;
  const typesArg = parseArg("--types");
  /** @type {BackfillType[]} */
  const types = typesArg
    ? /** @type {BackfillType[]} */ (
        typesArg.split(",").map((s) => s.trim()).filter(Boolean)
      )
    : ["vault", "bottom-candle"];

  console.log("[backfill] range", from, "→", to, "types", types.join(","));
  const rows = collectMissing(from, to, types);

  if (!rows.length) {
    console.log("[backfill] no missing scans in range");
    return;
  }

  for (const row of rows) {
    console.log(`[backfill] ${row.date} missing ${row.missing.length}`);
    for (const m of row.missing) {
      console.log(`  - ${m.type} ${m.market} ${m.detail ?? ""}`);
    }
  }

  if (checkOnly) {
    const reportPath = `${resolveServerDataDir()}/vault-scan-backfill-check.json`;
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ from, to, types, rows, at: new Date().toISOString() }, null, 2),
    );
    console.log("[backfill] check report", reportPath);
    return;
  }

  for (const row of rows) {
    await runBackfillForDate(row.date, row.missing);
  }

  try {
    const { flushScanReportEmailNow } = await import(
      "../server/notifications/scan-report-email-coalesce.js"
    );
    await flushScanReportEmailNow();
  } catch {
    /* ignore email flush errors */
  }

  console.log("[backfill] finished", rows.length, "date(s)");
}

main().catch((e) => {
  console.error("[backfill] fatal", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
