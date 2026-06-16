import { loadStock } from "./stock-data.js";
import { detectBookAccumulationLatest } from "./book-accumulation-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

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
  if (!sym) return { ok: true, hit: null };
  try {
    const data = await loadStock(sym, "1d", { live: true, scan: true });
    const tradable = await isGoldenCrossTradable(data, market, { timeframe: "1d" });
    if (!tradable.ok) {
      liveTradeLogInfo("[book-accum:scan] skip", sym, tradable.reason);
      return { ok: true, hit: null };
    }
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    const det = detectBookAccumulationLatest(candles);
    if (!det.anyAccum) return { ok: true, hit: null };
    return {
      ok: true,
      hit: {
        symbol: sym,
        name: resolveDisplayName(
          sym,
          String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
        ),
        market,
        timeframe: "1d",
        scanDate,
        signalDate: det.signalDate ?? scanDate,
        accumScore: det.score,
        accumRvol: det.rvol,
      },
    };
  } catch (e) {
    liveTradeLogWarn(
      "[book-accum:scan]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, hit: null };
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {{ persistState?: boolean }} [opts]
 */
export async function runBookAccumulationMarketScan(market, scanDate, opts = {}) {
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

  liveTradeLogInfo("[book-accum:scan] start", {
    market,
    scanDate,
    symbols: list.length,
  });

  /** @type {NonNullable<Awaited<ReturnType<typeof scanOneSymbol>>["hit"]>[]} */
  const hits = [];
  let errors = 0;

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbol(item, market, scanDate)),
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
    if (market === "kr") state.krLastScanDate = scanDate;
    else state.usLastScanDate = scanDate;
    state.lastRunAtMs = Date.now();
    state.lastRuns.unshift({
      market,
      scanDate,
      scanned: list.length,
      hits: hits.length,
      atMs: Date.now(),
    });
    state.lastRuns = state.lastRuns.slice(0, 28);
    writeState(state);
  }

  const out = {
    market,
    scanDate,
    scanned: list.length,
    hits,
    hitCount: hits.length,
    errors,
  };
  liveTradeLogInfo("[book-accum:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
    errors,
  });
  return out;
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 */
export function wasBookAccumulationScannedSync(market, scanDate) {
  const state = readState();
  const field = market === "us" ? "usLastScanDate" : "krLastScanDate";
  return state[field] === scanDate;
}

export function getBookAccumulationScanStateSync() {
  return readState();
}
