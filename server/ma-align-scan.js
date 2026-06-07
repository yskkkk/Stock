import { loadStock } from "./stock-data.js";
import { detectDailyMaAlignment } from "./ma-align-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadBoxRangeCatalogUniverse } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STATE_FILE = "ma-align-scan-state.json";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_MA_ALIGN_BATCH ?? process.env.STOCK_GOLDEN_CROSS_BATCH ?? 6);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(
    process.env.STOCK_MA_ALIGN_BATCH_DELAY_MS ??
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
  if (!sym) return null;
  try {
    const data = await loadStock(sym, "1d", { live: true });
    const tradable = await isGoldenCrossTradable(data, market);
    if (!tradable.ok) {
      liveTradeLogInfo("[ma-align:scan] skip", sym, tradable.reason);
      return null;
    }
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    if (!detectDailyMaAlignment(candles)) return null;
    return {
      symbol: sym,
      name: resolveDisplayName(
        sym,
        String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
      ),
      market,
      scanDate,
    };
  } catch (e) {
    liveTradeLogWarn(
      "[ma-align:scan]",
      sym,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 */
export async function runMaAlignMarketScan(market, scanDate) {
  const uni = await loadBoxRangeCatalogUniverse();
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[ma-align:scan] start", {
    market,
    scanDate,
    symbols: list.length,
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

  const out = {
    market,
    scanDate,
    scanned: list.length,
    hits,
    hitCount: hits.length,
  };
  liveTradeLogInfo("[ma-align:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
  });
  return out;
}

export function getMaAlignScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function wasMaAlignScannedSync(market, scanDate) {
  const state = readState();
  return market === "kr"
    ? state.krLastScanDate === scanDate
    : state.usLastScanDate === scanDate;
}
