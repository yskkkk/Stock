import { loadStock } from "./stock-data.js";
import { detectDailyGoldenCrossDetail } from "./golden-cross-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadBoxRangeCatalogUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

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
  return {
    krLastScanDate:
      typeof raw?.krLastScanDate === "string" ? raw.krLastScanDate : null,
    usLastScanDate:
      typeof raw?.usLastScanDate === "string" ? raw.usLastScanDate : null,
    lastRuns: Array.isArray(raw?.lastRuns)
      ? raw.lastRuns.slice(0, 14)
      : [],
  };
}

function readState() {
  return readJsonStoreSync(
    STATE_FILE,
    normalizeState,
    () => ({ krLastScanDate: null, usLastScanDate: null, lastRuns: [] }),
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
    const data = await loadStock(sym, "1d", { live: true });
    const tradable = await isGoldenCrossTradable(data, market);
    if (!tradable.ok) {
      liveTradeLogInfo("[golden-cross:scan] skip", sym, tradable.reason);
      return { ok: true, hit: null };
    }
    const candles = Array.isArray(data?.candles) ? data.candles : [];
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
        crosses,
        crossDate: crossDate ?? scanDate,
        scanDate,
      },
    };
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:scan]",
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
export async function runGoldenCrossMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
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
    state.lastRuns.unshift({
      market,
      scanDate,
      scanned: list.length,
      hits: hits.length,
      atMs: Date.now(),
    });
    state.lastRuns = state.lastRuns.slice(0, 14);
    writeState(state);
  }

  const out = {
    market,
    scanDate,
    scanned: list.length,
    hits,
    hitCount: hits.length,
  };
  liveTradeLogInfo("[golden-cross:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
    errors,
  });
  return out;
}

export function getGoldenCrossScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function markGoldenCrossScanDoneSync(market, scanDate) {
  const state = readState();
  if (market === "kr") state.krLastScanDate = scanDate;
  else state.usLastScanDate = scanDate;
  writeState(state);
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function wasGoldenCrossScannedSync(market, scanDate) {
  const state = readState();
  return market === "kr"
    ? state.krLastScanDate === scanDate
    : state.usLastScanDate === scanDate;
}
