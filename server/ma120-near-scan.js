import { loadStock } from "./stock-data.js";
import { getDailyMaValues, isPriceNearMa120 } from "./ma-align-detect.js";
import { truncateCandlesAsOf } from "./candle-asof.js";
import { buildDailyClosesIndex } from "./daily-bar-index.js";
import { detectMaApproach } from "./stock-vault-chart-insights.js";
import { isGoldenCrossTradable } from "./golden-cross-tradable.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadUniverse } from "./universe.js";
import { logVaultScanLoadFailure } from "./vault-scan-symbol-error.js";
import { liveTradeLogInfo } from "./live-trade-log.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const STATE_FILE = "ma120-near-scan-state.json";

const BATCH_SIZE = (() => {
  const n = Number(
    process.env.STOCK_MA120_NEAR_BATCH ??
      process.env.STOCK_MA_ALIGN_BATCH ??
      process.env.STOCK_GOLDEN_CROSS_BATCH ??
      6,
  );
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(
    process.env.STOCK_MA120_NEAR_BATCH_DELAY_MS ??
      process.env.STOCK_MA_ALIGN_BATCH_DELAY_MS ??
      process.env.STOCK_GOLDEN_CROSS_BATCH_DELAY_MS ??
      350,
  );
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 350;
})();

export const MA120_NEAR_THRESHOLD_PCT = (() => {
  const n = Number(process.env.STOCK_MA120_NEAR_PCT ?? 3);
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 3;
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
      lastRuns: [],
    }),
  );
}

/** @param {ReturnType<typeof normalizeState>} state */
function writeState(state) {
  writeJsonStoreSync(STATE_FILE, normalizeState(state));
}

/**
 * @param {number} price
 * @param {number} ma120
 * @param {number} [thresholdPct]
 */
export function ma120NearDistancePct(price, ma120, thresholdPct = MA120_NEAR_THRESHOLD_PCT) {
  const p = Number(price);
  const m = Number(ma120);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(m) || m <= 0) {
    return null;
  }
  return (Math.abs(p - m) / m) * 100;
}

/**
 * @param {{
 *   price: number;
 *   ma120: number;
 *   thresholdPct?: number;
 * }} input
 */
export function isMa120NearHit(input) {
  const thresholdPct = input.thresholdPct ?? MA120_NEAR_THRESHOLD_PCT;
  if (!isPriceNearMa120(input.price, input.ma120, thresholdPct)) return false;
  const distancePct = ma120NearDistancePct(input.price, input.ma120, thresholdPct);
  return distancePct != null;
}

/**
 * @param {number} price
 * @param {Array<{ close?: number }>} candles
 * @param {number} ma120
 * @returns {"from_below"|"from_above"|"flat"}
 */
export function detectMa120NearApproach(price, candles, ma120) {
  const p = Number(price);
  const m = Number(ma120);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(m) || m <= 0) {
    return "flat";
  }
  const { closes } = buildDailyClosesIndex(candles);
  if (closes.length < 5) return p < m ? "from_below" : p > m ? "from_above" : "flat";
  const last = closes.length - 1;
  const lookback = Math.min(4, last);
  const prevPrice = closes[last - lookback];
  const distNow = Math.abs(p - m);
  const distPrev = Math.abs(prevPrice - m);
  return detectMaApproach(p, prevPrice, m, distNow, distPrev);
}

/**
 * @param {{ symbol: string; name: string }} item
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 */
async function scanOneSymbol(item, market, scanDate, asOf = null) {
  const sym = String(item.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!sym) return null;
  const live = !asOf;
  try {
    const data = await loadStock(sym, "1d", { live, scan: !!asOf });
    const tradable = await isGoldenCrossTradable(data, market, { timeframe: "1d" });
    if (!tradable.ok) {
      liveTradeLogInfo("[ma120-near:scan] skip", sym, tradable.reason);
      return null;
    }
    const candles = truncateCandlesAsOf(
      Array.isArray(data?.candles) ? data.candles : [],
      asOf,
    );
    const ma = getDailyMaValues(candles);
    if (!ma) return null;

    // asOf(백필)에서는 실시간 시세가 그 날짜의 가격이 아니므로 기준일 종가를 사용.
    let price = asOf
      ? Number(candles[candles.length - 1]?.close)
      : Number(data?.quote?.price ?? data?.quote?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) {
      const lastClose = Number(candles[candles.length - 1]?.close);
      if (Number.isFinite(lastClose) && lastClose > 0) price = lastClose;
    }
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!isMa120NearHit({ price, ma120: ma.ma120 })) return null;

    const distancePct = ma120NearDistancePct(price, ma.ma120);
    if (distancePct == null) return null;
    let ma120Approach = detectMa120NearApproach(price, candles, ma.ma120);
    const ma120Side = price >= ma.ma120 ? "above" : "below";
    if (ma120Approach === "flat") {
      ma120Approach = ma120Side === "below" ? "from_below" : "from_above";
    }

    return {
      symbol: sym,
      name: resolveDisplayName(
        sym,
        String(item.name ?? data?.quote?.name ?? sym).trim() || sym,
      ),
      market,
      scanDate,
      ma120: ma.ma120,
      distancePct,
      ma120Approach,
      ma120Side,
    };
  } catch (e) {
    logVaultScanLoadFailure("ma120-near", sym, undefined, e);
    return null;
  }
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {{ persistState?: boolean; asOf?: string | null }} [opts]
 */
export async function runMa120NearMarketScan(market, scanDate, opts = {}) {
  const persistState = opts.persistState !== false;
  const asOf = opts.asOf ?? null;
  const uni = await loadUniverse();
  const list =
    market === "kr"
      ? Array.isArray(uni?.kr)
        ? uni.kr
        : []
      : Array.isArray(uni?.us)
        ? uni.us
        : [];

  liveTradeLogInfo("[ma120-near:scan] start", {
    market,
    scanDate,
    symbols: list.length,
    thresholdPct: MA120_NEAR_THRESHOLD_PCT,
  });

  /** @type {Awaited<ReturnType<typeof scanOneSymbol>>[]} */
  const hits = [];
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const total = list.length;
  onProgress?.({ scanned: 0, total, phase: "running" });

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbol(item, market, scanDate, asOf)),
    );
    for (const r of results) {
      if (r) hits.push(r);
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
    const field = market === "kr" ? "krLastScanDate" : "usLastScanDate";
    state[field] = scanDate;
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
    timeframe: /** @type {const} */ ("1d"),
    scanned: list.length,
    hits,
    hitCount: hits.length,
  };
  liveTradeLogInfo("[ma120-near:scan] done", {
    market,
    scanDate,
    scanned: list.length,
    hits: hits.length,
  });
  return out;
}

export function getMa120NearScanStateSync() {
  return readState();
}

/** @param {"kr"|"us"} market @param {string} scanDate */
export function wasMa120NearScannedSync(market, scanDate) {
  const state = readState();
  const field = market === "kr" ? "krLastScanDate" : "usLastScanDate";
  return state[field] === scanDate;
}
