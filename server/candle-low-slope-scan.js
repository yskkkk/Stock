import { loadStock } from "./stock-data.js";
import { detectCandleLowSlopeFlipLatest } from "./candle-low-slope-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import { candlesForWeeklyMaScan } from "./weekly-candle-trim.js";
import {
  vaultScanChartTimeframe,
  vaultScanStateDateField,
} from "./vault-scan-timeframe.js";

const STATE_FILE = "candle-low-slope-scan-state.json";
const LOW_SLOPE_SCAN_TIMEFRAME = /** @type {const} */ ("1wk");

const BATCH_SIZE = (() => {
  const n = Number(
    process.env.STOCK_LOW_SLOPE_BATCH ??
      process.env.STOCK_MA120_NEAR_BATCH ??
      process.env.STOCK_GOLDEN_CROSS_BATCH ??
      6,
  );
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(
    process.env.STOCK_LOW_SLOPE_BATCH_DELAY_MS ??
      process.env.STOCK_MA120_NEAR_BATCH_DELAY_MS ??
      350,
  );
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 350;
})();

const PIVOT_LEFT = (() => {
  const n = Number(process.env.STOCK_LOW_SLOPE_PIVOT_LEFT ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
})();

const PIVOT_RIGHT = (() => {
  const n = Number(process.env.STOCK_LOW_SLOPE_PIVOT_RIGHT ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
})();

const RECENT_BARS = (() => {
  const n = Number(process.env.STOCK_LOW_SLOPE_RECENT_BARS ?? 8);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : 8;
})();

/** @param {number} ms */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {unknown} raw */
function normalizeState(raw) {
  const lastRuns = Array.isArray(raw?.lastRuns)
    ? raw.lastRuns.slice(0, 28).map((row) => ({
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
 */
async function scanOneSymbol(item, market, scanDate) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return null;
  try {
    const chartTf = vaultScanChartTimeframe(LOW_SLOPE_SCAN_TIMEFRAME);
    const data = await loadStock(sym, chartTf, { live: true, scan: true });
    const tradable = await isGoldenCrossTradable(data, market, {
      timeframe: LOW_SLOPE_SCAN_TIMEFRAME,
    });
    if (!tradable.ok) {
      liveTradeLogInfo("[low-slope:scan] skip", sym, tradable.reason);
      return null;
    }
    let candles = Array.isArray(data?.candles) ? data.candles : [];
    const daily = await loadStock(sym, "1d", { live: true, scan: true });
    candles = candlesForWeeklyMaScan(
      candles,
      Array.isArray(daily?.candles) ? daily.candles : [],
    );
    const det = detectCandleLowSlopeFlipLatest(candles, {
      pivotLeft: PIVOT_LEFT,
      pivotRight: PIVOT_RIGHT,
      recentBars: RECENT_BARS,
    });
    if (!det.hit) return null;
    return {
      symbol: sym,
      name: resolveDisplayName(
        sym,
        String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
      ),
      market,
      scanDate,
      signalDate: det.signalDate ?? scanDate,
      lowSlopeFlip: det.lowSlopeFlip,
      pivotLow: det.pivotLow,
    };
  } catch (e) {
    liveTradeLogWarn(
      "[low-slope:scan]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {{ persistState?: boolean }} [opts]
 */
export async function runCandleLowSlopeMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
  const uni = await loadUniverse();
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[low-slope:scan] start", {
    market,
    scanDate,
    timeframe: LOW_SLOPE_SCAN_TIMEFRAME,
    symbols: list.length,
    pivotLeft: PIVOT_LEFT,
    pivotRight: PIVOT_RIGHT,
    recentBars: RECENT_BARS,
  });

  /** @type {Awaited<ReturnType<typeof scanOneSymbol>>[]} */
  const hits = [];

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbol(item, market, scanDate)),
    );
    for (const r of results) {
      if (r) hits.push(r);
    }
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }

  if (persistState) {
    const state = readState();
    const field = vaultScanStateDateField(market, LOW_SLOPE_SCAN_TIMEFRAME);
    state[field] = scanDate;
    state.lastRuns.unshift({
      market,
      scanDate,
      scanned: list.length,
      hits: hits.length,
      atMs: Date.now(),
    });
    state.lastRuns = state.lastRuns.slice(0, 28);
    state.lastRunAtMs = Date.now();
    writeState(state);
  }

  const out = {
    market,
    scanDate,
    timeframe: LOW_SLOPE_SCAN_TIMEFRAME,
    scanned: list.length,
    hits,
    hitCount: hits.length,
  };
  liveTradeLogInfo("[low-slope:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
  });
  return out;
}

export function getCandleLowSlopeScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function wasCandleLowSlopeScannedSync(market, scanDate) {
  const state = readState();
  const field = vaultScanStateDateField(market, LOW_SLOPE_SCAN_TIMEFRAME);
  return state[field] === scanDate;
}
