/**
 * 그랜빌 8법칙 유니버스 스캔 — 일봉 기준선(MA200).
 * 매수(매수1~4)·매도(매도1~4) 신호를 모두 종목보관함(vault)에 반영한다.
 */

import { loadStock } from "./stock-data.js";
import { detectGranvilleLatest } from "./granville-detect.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadVaultScanUniverse } from "./universe.js";
import { finishVaultScanSymbolOnLoadError } from "./vault-scan-symbol-error.js";
import { liveTradeLogInfo } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";
import { GRANVILLE_MA_PERIOD_DEFAULT } from "../shared/granville-rules.js";

const STATE_FILE = "granville-scan-state.json";

const GRANVILLE_MA_PERIOD = (() => {
  const n = Number(process.env.STOCK_GRANVILLE_MA_PERIOD ?? GRANVILLE_MA_PERIOD_DEFAULT);
  return Number.isFinite(n) && n >= 20 ? Math.min(Math.round(n), 400) : GRANVILLE_MA_PERIOD_DEFAULT;
})();

const BATCH_SIZE = (() => {
  const n = Number(
    process.env.STOCK_GRANVILLE_BATCH ?? process.env.STOCK_GOLDEN_CROSS_BATCH ?? 6,
  );
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(
    process.env.STOCK_GRANVILLE_BATCH_DELAY_MS ??
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
          typeof row?.hits === "number" && Number.isFinite(row.hits) ? row.hits : 0,
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
  return readJsonStoreSync(STATE_FILE, normalizeState, () => ({
    krLastScanDate: null,
    usLastScanDate: null,
    lastRunAtMs: null,
    lastRuns: [],
  }));
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
      liveTradeLogInfo("[granville:scan] skip", sym, tradable.reason);
      return { ok: true, hit: null };
    }
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    const det = detectGranvilleLatest(candles, { maPeriod: GRANVILLE_MA_PERIOD });
    // 매수·매도 신호 모두 보관함 반영
    if (!det.signal) return { ok: true, hit: null };
    return {
      ok: true,
      hit: {
        symbol: sym,
        name: resolveDisplayName(
          sym,
          String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
        ),
        market,
        scanDate,
        signalDate: det.signalDate ?? scanDate,
        granvilleSignal: det.signal,
        granvilleCode: det.code,
        granvilleSide: det.side,
        granvilleMaPeriod: det.maPeriod,
        granvilleDisparity: det.disparityPct,
      },
    };
  } catch (e) {
    return finishVaultScanSymbolOnLoadError("granville", sym, "1d", e);
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {{ persistState?: boolean; onProgress?: (p: { scanned: number; total: number; phase: string }) => void }} [opts]
 */
export async function runGranvilleMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
  const uni = await loadVaultScanUniverse(market, "1d");
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[granville:scan] start", {
    market,
    scanDate,
    maPeriod: GRANVILLE_MA_PERIOD,
    universe: uni.scope,
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
      batch.map((entry) => scanOneSymbol(entry, market, scanDate)),
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
    state.lastRuns = state.lastRuns.slice(0, 48);
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
  liveTradeLogInfo("[granville:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
    errors,
  });
  return out;
}

export function getGranvilleScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function wasGranvilleScannedSync(market, scanDate) {
  const state = readState();
  const field = market === "kr" ? state.krLastScanDate : state.usLastScanDate;
  return field === scanDate;
}
