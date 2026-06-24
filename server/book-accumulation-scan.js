import { loadStock } from "./stock-data.js";
import { detectBookAccumulationLatest } from "./book-accumulation-detect.js";
import { candlesForWeeklyMaScan } from "./weekly-candle-trim.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import {
  loadBookAccumScanUniverse,
  resolveBookAccumUniverseScope,
} from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import {
  normalizeVaultScanTimeframe,
  vaultScanChartTimeframe,
  vaultScanStateDateField,
} from "./vault-scan-timeframe.js";

const STATE_FILE = "book-accumulation-scan-state.json";

const BATCH_SIZE = (() => {
  const n = Number(
    process.env.STOCK_BOOK_ACCUM_BATCH ??
      process.env.STOCK_GOLDEN_CROSS_BATCH ??
      6,
  );
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(
    process.env.STOCK_BOOK_ACCUM_BATCH_DELAY_MS ??
      process.env.STOCK_GOLDEN_CROSS_BATCH_DELAY_MS ??
      350,
  );
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 350;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} raw */
function normalizeState(raw) {
  const lastRuns = Array.isArray(raw?.lastRuns)
    ? raw.lastRuns.slice(0, 48).map((row) => ({
        market: row?.market === "us" ? "us" : "kr",
        scanDate: typeof row?.scanDate === "string" ? row.scanDate : "",
        scanned:
          typeof row?.scanned === "number" && Number.isFinite(row.scanned)
            ? row.scanned
            : 0,
        hits:
          typeof row?.hits === "number" && Number.isFinite(row.hits)
            ? row.hits
            : 0,
        atMs:
          typeof row?.atMs === "number" && Number.isFinite(row.atMs)
            ? row.atMs
            : Date.now(),
        timeframe: normalizeVaultScanTimeframe(row?.timeframe),
      }))
    : [];
  return {
    krLastScanDate:
      typeof raw?.krLastScanDate === "string" ? raw.krLastScanDate : null,
    usLastScanDate:
      typeof raw?.usLastScanDate === "string" ? raw.usLastScanDate : null,
    krWeeklyLastScanDate:
      typeof raw?.krWeeklyLastScanDate === "string"
        ? raw.krWeeklyLastScanDate
        : null,
    usWeeklyLastScanDate:
      typeof raw?.usWeeklyLastScanDate === "string"
        ? raw.usWeeklyLastScanDate
        : null,
    lastRunAtMs:
      typeof raw?.lastRunAtMs === "number" && Number.isFinite(raw.lastRunAtMs)
        ? raw.lastRunAtMs
        : null,
    lastRuns,
  };
}

function readState() {
  return readJsonStoreSync(
    STATE_FILE,
    normalizeState,
    () => ({
      krLastScanDate: null,
      usLastScanDate: null,
      krWeeklyLastScanDate: null,
      usWeeklyLastScanDate: null,
      lastRunAtMs: null,
      lastRuns: [],
    }),
  );
}

/** @param {ReturnType<typeof normalizeState>} state */
function writeState(state) {
  writeJsonStoreSync(STATE_FILE, normalizeState(state));
}

/**
 * @param {{ symbol: string; name: string }} item
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe]
 */
async function scanOneSymbol(item, market, scanDate, timeframe = "1d") {
  const tf = normalizeVaultScanTimeframe(timeframe);
  const chartTf = vaultScanChartTimeframe(tf);
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return { ok: true, hit: null };
  try {
    const data = await loadStock(sym, chartTf, { live: true, scan: true });
    const tradable = await isGoldenCrossTradable(data, market, { timeframe: tf });
    if (!tradable.ok) {
      liveTradeLogInfo("[book-accum:scan] skip", sym, tf, tradable.reason);
      return { ok: true, hit: null };
    }
    let candles = Array.isArray(data?.candles) ? data.candles : [];
    if (tf === "1wk") {
      const daily = await loadStock(sym, "1d", { live: true, scan: true });
      candles = candlesForWeeklyMaScan(
        candles,
        Array.isArray(daily?.candles) ? daily.candles : [],
      );
    }
    const det = detectBookAccumulationLatest(candles);
    if (det.hitCount < 1) return { ok: true, hit: null };
    const latest = det.hits.at(-1);
    return {
      ok: true,
      hit: {
        symbol: sym,
        name: resolveDisplayName(
          sym,
          String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
        ),
        market,
        timeframe: tf,
        scanDate,
        signalDate: latest?.signalDate ?? det.signalDate ?? scanDate,
        accumCount: det.hitCount,
        accumScore: latest?.score ?? det.score,
        accumRvol: latest?.rvol ?? det.rvol,
      },
    };
  } catch (e) {
    liveTradeLogWarn(
      "[book-accum:scan]",
      sym,
      tf,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, hit: null };
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {{ persistState?: boolean; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe }} [opts]
 */
export async function runBookAccumulationMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
  const timeframe = normalizeVaultScanTimeframe(opts.timeframe);
  const accumScope = resolveBookAccumUniverseScope(market, timeframe);
  const uni = await loadBookAccumScanUniverse(accumScope);
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[book-accum:scan] start", {
    market,
    scanDate,
    timeframe,
    universe: uni.scope ?? accumScope,
    symbols: list.length,
  });

  /** @type {NonNullable<Awaited<ReturnType<typeof scanOneSymbol>>["hit"]>[]} */
  const hits = [];
  let errors = 0;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const total = list.length;
  onProgress?.({ scanned: 0, total, phase: "running" });

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbol(item, market, scanDate, timeframe)),
    );
    for (const r of results) {
      if (!r.ok) {
        errors += 1;
        continue;
      }
      if (r.hit) hits.push(r.hit);
    }
    onProgress?.({
      scanned: Math.min(i + batch.length, total),
      total,
      phase: "running",
    });
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }
  onProgress?.({ scanned: total, total, phase: "done" });

  if (persistState) {
    const state = readState();
    const field = vaultScanStateDateField(market, timeframe);
    state[field] = scanDate;
    state.lastRunAtMs = Date.now();
    state.lastRuns.unshift({
      market,
      scanDate,
      scanned: list.length,
      hits: hits.length,
      errors,
      atMs: Date.now(),
      timeframe,
    });
    state.lastRuns = state.lastRuns.slice(0, 48);
    writeState(state);
  }

  const out = {
    market,
    scanDate,
    timeframe,
    scanned: list.length,
    hits,
    hitCount: hits.length,
    errors,
  };
  liveTradeLogInfo("[book-accum:scan] done", {
    market,
    scanDate,
    timeframe,
    scanned: list.length,
    hits: hits.length,
    errors,
  });
  return out;
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe]
 */
export function wasBookAccumulationScannedSync(
  market,
  scanDate,
  timeframe = "1d",
) {
  const state = readState();
  const field = vaultScanStateDateField(market, timeframe);
  return state[field] === scanDate;
}

export function getBookAccumulationScanStateSync() {
  return readState();
}
