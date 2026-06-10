import { loadStock } from "./stock-data.js";
import { detectDailyGoldenCrossDetail } from "./golden-cross-detect.js";
import { candlesForWeeklyMaScan } from "./weekly-candle-trim.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadBoxRangeCatalogUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import {
  normalizeVaultScanTimeframe,
  vaultScanChartTimeframe,
  vaultScanStateDateField,
} from "./vault-scan-timeframe.js";

const STATE_FILE = "golden-cross-scan-state.json";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_GOLDEN_CROSS_BATCH ?? 6);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_GOLDEN_CROSS_BATCH_DELAY_MS ?? 350);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 350;
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
    const data = await loadStock(sym, chartTf, { live: true });
    const tradable = await isGoldenCrossTradable(data, market, { timeframe: tf });
    if (!tradable.ok) {
      liveTradeLogInfo("[golden-cross:scan] skip", sym, tf, tradable.reason);
      return { ok: true, hit: null };
    }
    let candles = Array.isArray(data?.candles) ? data.candles : [];
    if (tf === "1wk") {
      const daily = await loadStock(sym, "1d", { live: true });
      candles = candlesForWeeklyMaScan(
        candles,
        Array.isArray(daily?.candles) ? daily.candles : [],
      );
    }
    const { crosses, crossDate } = detectDailyGoldenCrossDetail(candles);
    if (!crosses.length) return { ok: true, hit: null };
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
        crosses,
        crossDate: crossDate ?? scanDate,
        scanDate,
      },
    };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:scan]",
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
export async function runGoldenCrossMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
  const timeframe = normalizeVaultScanTimeframe(opts.timeframe);
  const uni = await loadBoxRangeCatalogUniverse();
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[golden-cross:scan] start", {
    market,
    scanDate,
    timeframe,
    symbols: list.length,
  });

  /** @type {NonNullable<Awaited<ReturnType<typeof scanOneSymbol>>["hit"]>[]} */
  const hits = [];
  let errors = 0;

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
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }

  if (persistState) {
    const state = readState();
    const field = vaultScanStateDateField(market, timeframe);
    state[field] = scanDate;
    state.lastRuns.unshift({
      market,
      scanDate,
      scanned: list.length,
      hits: hits.length,
      atMs: Date.now(),
      timeframe,
    });
    state.lastRuns = state.lastRuns.slice(0, 28);
    writeState(state);
  }

  const out = {
    market,
    scanDate,
    timeframe,
    scanned: list.length,
    hits,
    hitCount: hits.length,
  };
  liveTradeLogInfo("[golden-cross:scan] done", {
    market,
    scanDate,
    timeframe,
    scanned: list.length,
    hits: hits.length,
    errors,
  });
  return out;
}

export function getGoldenCrossScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe] */
export function markGoldenCrossScanDoneSync(market, scanDate, timeframe = "1d") {
  const state = readState();
  const field = vaultScanStateDateField(market, timeframe);
  state[field] = scanDate;
  writeState(state);
}

/** @param {"kr"|"us"} market @param {string} scanDate @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} [timeframe] */
export function wasGoldenCrossScannedSync(market, scanDate, timeframe = "1d") {
  const state = readState();
  const field = vaultScanStateDateField(market, timeframe);
  return state[field] === scanDate;
}
