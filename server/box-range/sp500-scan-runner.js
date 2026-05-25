import { loadUniverse } from "../universe.js";
import { loadStock } from "../stock-data.js";
import { BOX_RANGE_SP500_SCAN_MS, BOX_RANGE_TIMEFRAMES } from "./constants.js";
import { detectBoxRangesProOnCandles } from "./detect-pro.js";
import { upsertSymbolCatalogDetectionsSync } from "./catalog-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SP500_BATCH ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 4;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SP500_BATCH_DELAY_MS ?? 400);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 400;
})();

function normalizeTime(t) {
  if (Number.isFinite(t)) return t;
  if (t && typeof t === "object" && t.year) {
    return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000) - 9 * 3600;
  }
  return null;
}

/**
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
async function loadCandles(symbol, timeframe) {
  const data = await loadStock(symbol, timeframe, { live: true });
  const candles = Array.isArray(data?.candles) ? data.candles : [];
  return candles
    .map((c) => {
      if (!c) return null;
      const time = normalizeTime(c.time);
      if (time == null || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
        return null;
      }
      return { ...c, time };
    })
    .filter(Boolean);
}

/**
 * @param {{ symbol: string; name: string }} item
 */
async function scanOneSymbol(item) {
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  if (!sym) return { ok: false };
  /** @type {Partial<Record<"1h"|"4h"|"1d", import("./detect-pro.js").DetectedBox[]>>} */
  const byTf = {};
  let scanError = null;
  try {
    for (const tf of BOX_RANGE_TIMEFRAMES) {
      const candles = await loadCandles(sym, tf);
      if (candles.length < 20) {
        byTf[tf] = [];
        continue;
      }
      const confirmed = candles.slice(0, -1);
      byTf[tf] = detectBoxRangesProOnCandles(confirmed, tf, 5);
    }
    upsertSymbolCatalogDetectionsSync(sym, item.name ?? sym, byTf, null);
    return { ok: true, symbol: sym };
  } catch (e) {
    scanError = e instanceof Error ? e.message : String(e);
    upsertSymbolCatalogDetectionsSync(
      sym,
      item.name ?? sym,
      {},
      scanError,
    );
    return { ok: false, symbol: sym, error: scanError };
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runSp500BoxRangeCatalogScan() {
  const uni = await loadUniverse();
  const list = Array.isArray(uni?.us) ? uni.us : [];
  if (!list.length) {
    liveTradeLogWarn("[box-range:sp500-scan] universe.us empty");
    return { scanned: 0, errors: 0 };
  }

  let ok = 0;
  let errors = 0;
  liveTradeLogInfo("[box-range:sp500-scan] start", list.length, "symbols");

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((item) => scanOneSymbol(item)));
    for (const r of results) {
      if (r.ok) ok += 1;
      else errors += 1;
    }
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }

  liveTradeLogInfo("[box-range:sp500-scan] done", { ok, errors, total: list.length });
  return { scanned: list.length, ok, errors };
}

export function startSp500BoxRangeCatalogPoller() {
  if (process.env.STOCK_BOX_RANGE_SP500_SCAN === "0") return;
  const g = /** @type {typeof globalThis & { __stockBoxRangeSp500Scan?: boolean }} */ (
    globalThis
  );
  if (g.__stockBoxRangeSp500Scan) return;
  g.__stockBoxRangeSp500Scan = true;

  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    runSp500BoxRangeCatalogScan()
      .catch((e) => {
        liveTradeLogWarn(
          "[box-range:sp500-scan]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  loop();
  setInterval(loop, BOX_RANGE_SP500_SCAN_MS);
}
