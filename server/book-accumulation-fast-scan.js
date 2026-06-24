/**
 * 매집봉 고속 스캔 — 종목당 1회 루프·스캔 세션 캐시·Yahoo 튜닝·Worker
 */
import { performance } from "node:perf_hooks";
import { detectBookAccumulationLatest } from "./book-accumulation-detect.js";
import { candlesForWeeklyMaScan } from "./weekly-candle-trim.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import {
  loadBookAccumScanUniverse,
  BOOK_ACCUM_US_UNIVERSE_SCOPE,
  BOOK_ACCUM_KR_UNIVERSE_SCOPE,
  resolveBookAccumUniverseScope,
} from "./universe.js";
import { loadStock, runStockDataScanSession } from "./stock-data.js";
import { runWithYahooScanTune } from "./yahoo-queue.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import {
  assessScanVaultMerge,
  applyVaultScanMerge,
} from "./scan-vault-merge.js";
import {
  clearBookAccumVaultItemsSync,
  mergeBookAccumHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { normalizeVaultScanTimeframe } from "./vault-scan-timeframe.js";
import {
  beginVaultScanProgressSession,
  endVaultScanProgressSession,
  vaultScanProgressReporter,
} from "./vault-scan-progress.js";

const STATE_FILE = "book-accumulation-fast-scan-state.json";

/** 매집봉 고속 스캔 — 일봉·주봉 항상 (탐지 로직은 vault와 동일) */
export const BOOK_ACCUM_FAST_TIMEFRAMES = /** @type {const} */ (["1d", "1wk"]);

const FAST_LOAD_OPTS = { live: false, scan: true, scanSession: true };

function fastBatchSize() {
  const n = Number(process.env.STOCK_BOOK_ACCUM_FAST_BATCH ?? 16);
  return Number.isFinite(n) && n >= 1 ? Math.min(24, Math.floor(n)) : 16;
}

function fastBatchDelayMs() {
  const n = Number(process.env.STOCK_BOOK_ACCUM_FAST_BATCH_DELAY_MS ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 2_000) : 0;
}

function fastYahooTune() {
  const maxConcurrent = Number(
    process.env.STOCK_BOOK_ACCUM_FAST_YAHOO_CONCURRENT ?? 8,
  );
  const minGapMs = Number(process.env.STOCK_BOOK_ACCUM_FAST_YAHOO_GAP_MS ?? 100);
  return {
    maxConcurrent:
      Number.isFinite(maxConcurrent) && maxConcurrent >= 1
        ? Math.min(8, Math.floor(maxConcurrent))
        : 8,
    minGapMs:
      Number.isFinite(minGapMs) && minGapMs >= 0 ? minGapMs : 100,
  };
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} raw */
function normalizeState(raw) {
  return {
    lastRunAtMs:
      typeof raw?.lastRunAtMs === "number" && Number.isFinite(raw.lastRunAtMs)
        ? raw.lastRunAtMs
        : null,
    lastRuns: Array.isArray(raw?.lastRuns)
      ? raw.lastRuns.slice(0, 24).map((row) => ({
          scope: String(row?.scope ?? ""),
          market: row?.market === "kr" ? "kr" : "us",
          scanDate: String(row?.scanDate ?? ""),
          scanned: Number(row?.scanned) || 0,
          hitCount: Number(row?.hitCount) || 0,
          durationMs: Number(row?.durationMs) || 0,
          timeframes: String(row?.timeframes ?? ""),
          atMs: Number(row?.atMs) || Date.now(),
        }))
      : [],
  };
}

function readState() {
  return readJsonStoreSync(STATE_FILE, normalizeState, () => ({
    lastRunAtMs: null,
    lastRuns: [],
  }));
}

/** @param {ReturnType<typeof normalizeState>} state */
function writeState(state) {
  writeJsonStoreSync(STATE_FILE, normalizeState(state));
}

/**
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} timeframe
 * @param {object} data
 * @param {Array<{ time?: number; close?: number; high?: number; low?: number; volume?: number }>} candles
 * @param {string} scanDate
 * @param {{ symbol: string; name?: string }} item
 * @param {"kr"|"us"} market
 */
function buildHitIfAny(timeframe, data, candles, scanDate, item, market) {
  const det = detectBookAccumulationLatest(candles);
  if (det.hitCount < 1) return null;
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  const latest = det.hits.at(-1);
  return {
    symbol: sym,
    name: resolveDisplayName(
      sym,
      String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
    ),
    market,
    timeframe,
    scanDate,
    signalDate: latest?.signalDate ?? det.signalDate ?? scanDate,
    accumCount: det.hitCount,
    accumScore: latest?.score ?? det.score,
    accumRvol: latest?.rvol ?? det.rvol,
  };
}

/**
 * 종목당 1d·1wk 통합 — 일봉 1회 fetch 후 주봉은 일봉 재사용
 * @param {{ symbol: string; name?: string }} item
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {Set<import("./vault-scan-timeframe.js").VaultScanTimeframe>} timeframes
 */
export async function scanOneSymbolBookAccumFast(
  item,
  market,
  scanDate,
  timeframes,
) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return { ok: true, hits: [] };

  /** @type {NonNullable<ReturnType<typeof buildHitIfAny>>[]} */
  const hits = [];

  try {
    let dailyData = null;
    if (timeframes.has("1d") || timeframes.has("1wk")) {
      dailyData = await loadStock(sym, "1d", FAST_LOAD_OPTS);
    }

    if (timeframes.has("1d") && dailyData) {
      const tradable = await isGoldenCrossTradable(dailyData, market, {
        timeframe: "1d",
      });
      if (tradable.ok) {
        const candles = Array.isArray(dailyData.candles) ? dailyData.candles : [];
        const hit = buildHitIfAny("1d", dailyData, candles, scanDate, item, market);
        if (hit) hits.push(hit);
      }
    }

    if (timeframes.has("1wk")) {
      const weeklyData = await loadStock(sym, "1wk", FAST_LOAD_OPTS);
      const tradable = await isGoldenCrossTradable(weeklyData, market, {
        timeframe: "1wk",
      });
      if (tradable.ok) {
        const dailyCandles = Array.isArray(dailyData?.candles)
          ? dailyData.candles
          : [];
        let candles = Array.isArray(weeklyData?.candles)
          ? weeklyData.candles
          : [];
        if (dailyCandles.length) {
          candles = candlesForWeeklyMaScan(candles, dailyCandles);
        }
        const hit = buildHitIfAny(
          "1wk",
          weeklyData,
          candles,
          scanDate,
          item,
          market,
        );
        if (hit) hits.push(hit);
      }
    }

    return { ok: true, hits };
  } catch (e) {
    liveTradeLogWarn(
      "[book-accum:fast]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, hits: [] };
  }
}

/**
 * @param {Set<import("./vault-scan-timeframe.js").VaultScanTimeframe>} timeframes
 */
function normalizeTimeframeSet(timeframes) {
  const set = new Set();
  for (const tf of timeframes) {
    set.add(normalizeVaultScanTimeframe(tf));
  }
  if (!set.size) {
    set.add("1d");
    set.add("1wk");
  }
  return set;
}

/**
 * @param {{
 *   scope?: "sp500"|"nasdaq"|"toss-us"|"us";
 *   market?: "kr"|"us";
 *   scanDate: string;
 *   mergeVault?: boolean;
 *   persistState?: boolean;
 * }} opts
 */
export async function runBookAccumulationFastScan(opts) {
  const scope = String(opts.scope ?? BOOK_ACCUM_US_UNIVERSE_SCOPE)
    .trim()
    .toLowerCase();
  const market =
    opts.market ??
    (scope === "toss-us" ||
    scope === "toss" ||
    scope === "us-full" ||
    scope === "us" ||
    scope === "nasdaq"
      ? "us"
      : "kr");
  const scanDate = String(opts.scanDate ?? "").trim();
  if (!scanDate) throw new Error("scanDate required");

  const tfSet = normalizeTimeframeSet(new Set(BOOK_ACCUM_FAST_TIMEFRAMES));
  const mergeVault = opts.mergeVault !== false;
  const persistState = opts.persistState !== false;

  const startedAt = performance.now();
  const accumScope =
    opts.scope ??
    resolveBookAccumUniverseScope(market, [...tfSet][0] ?? "1d");
  const uni = await loadBookAccumScanUniverse(accumScope);
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[book-accum:fast] start", {
    scope: uni.scope ?? scope,
    market,
    scanDate,
    symbols: list.length,
    timeframes: [...tfSet],
  });

  const batchSize = fastBatchSize();
  const batchDelay = fastBatchDelayMs();
  const yahooTune = fastYahooTune();
  const onProgress = vaultScanProgressReporter("book_accum_fast", market, "1d");
  const total = list.length;

  /** @type {NonNullable<ReturnType<typeof buildHitIfAny>>[]} */
  const hits = [];
  let errors = 0;

  beginVaultScanProgressSession(`book-accum-fast-${scanDate}-${Date.now()}`);
  try {
  onProgress({ scanned: 0, total, phase: "running" });

  const runLoop = async () => {
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((item) =>
          scanOneSymbolBookAccumFast(item, market, scanDate, tfSet),
        ),
      );
      for (const r of results) {
        if (!r.ok) errors += 1;
        else if (r.hits.length) hits.push(...r.hits);
      }
      onProgress({
        scanned: Math.min(i + batch.length, total),
        total,
        phase: "running",
      });
      if (i + batchSize < list.length && batchDelay > 0) {
        await delay(batchDelay);
      }
    }
    onProgress({ scanned: total, total, phase: "done" });
  };

  await runWithYahooScanTune(yahooTune, () =>
    runStockDataScanSession({ maxKeys: 22_000, maxAgeMs: 900_000 }, runLoop),
  );

  let vaultMerge;
  if (mergeVault) {
    vaultMerge = applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: list.length,
        hitCount: hits.length,
        errors,
      }),
      {
        clear: () => {
          for (const tf of tfSet) {
            clearBookAccumVaultItemsSync({ market, timeframe: tf });
          }
        },
        merge: (mergedHits) =>
          mergeBookAccumHitsIntoVaultSync(/** @type {typeof hits} */ (mergedHits)),
      },
      hits,
    );
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const out = {
    scope: uni.scope ?? scope,
    market,
    scanDate,
    timeframes: [...tfSet],
    scanned: list.length,
    hits,
    hitCount: hits.length,
    errors,
    durationMs,
    yahooTune,
    batchSize,
  };

  if (persistState) {
    const state = readState();
    state.lastRunAtMs = Date.now();
    state.lastRuns.unshift({
      scope: out.scope,
      market,
      scanDate,
      scanned: list.length,
      hitCount: hits.length,
      errors,
      mergeOutcome: vaultMerge?.outcome ?? null,
      durationMs,
      timeframes: [...tfSet].join(","),
      atMs: Date.now(),
    });
    state.lastRuns = state.lastRuns.slice(0, 24);
    writeState(state);
  }

  liveTradeLogInfo("[book-accum:fast] done", {
    scope: out.scope,
    market,
    scanned: list.length,
    hits: hits.length,
    errors,
    mergeOutcome: vaultMerge?.outcome ?? null,
    durationMs,
  });

  return out;
  } finally {
    endVaultScanProgressSession();
  }
}

export function getBookAccumulationFastScanStateSync() {
  return readState();
}

export function bookAccumFastScanEnabled() {
  return String(process.env.STOCK_BOOK_ACCUM_FAST_SCAN ?? "1").trim() !== "0";
}
