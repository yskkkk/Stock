import { loadStock } from "../stock-data.js";
import { BOX_RANGE_PINE_MAX_STORE, BOX_RANGE_TIMEFRAMES } from "./constants.js";
import { detectBoxRangesPineOnCandles, resolvePineDetectOpts } from "./detect-pine.js";
import {
  resolveCatalogRootDir,
  upsertSymbolCatalogDetectionsSync,
} from "./catalog-store.js";
import { normalizeBoxUnixTime } from "./box-time.js";

/**
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
export async function loadCandlesForBoxScan(symbol, timeframe) {
  try {
    const data = await loadStock(symbol, timeframe, { live: true });
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    return candles
      .map((c) => {
        if (!c) return null;
        const time = normalizeBoxUnixTime(c.time);
        if (time == null || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
          return null;
        }
        return { ...c, time };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {{ symbol: string; name: string }} item
 * @param {"us"|"kr"|"crypto"} catalogMarket
 */
export async function scanOneSymbolCatalog(item, catalogMarket) {
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  if (!sym) return { ok: false, symbol: sym, error: "empty symbol" };
  const pineOpts = resolvePineDetectOpts();
  /** @type {Partial<Record<"1h"|"4h"|"1d", import("./detect-pine.js").DetectedBox[]>>} */
  const byTf = {};
  let tfOk = 0;
  let totalBoxes = 0;
  /** @type {string[]} */
  const tfErrors = [];

  for (const tf of BOX_RANGE_TIMEFRAMES) {
    try {
      const candles = await loadCandlesForBoxScan(sym, tf);
      if (candles.length < 20) {
        byTf[tf] = [];
        continue;
      }
      tfOk += 1;
      // 전체 차트 1회 Pine f_zoneEngine (maxStoreZones=40)
      byTf[tf] = detectBoxRangesPineOnCandles(
        candles,
        tf,
        BOX_RANGE_PINE_MAX_STORE,
        pineOpts,
      );
      totalBoxes += byTf[tf].length;
    } catch (e) {
      tfErrors.push(`${tf}:${e instanceof Error ? e.message : e}`);
      byTf[tf] = [];
    }
  }

  const scanError =
    tfOk === 0
      ? tfErrors.length
        ? tfErrors.join("; ")
        : "봉 데이터 없음(1h·4h·1d)"
      : null;

  upsertSymbolCatalogDetectionsSync(
    sym,
    item.name ?? sym,
    byTf,
    scanError,
    catalogMarket,
    resolveCatalogRootDir(),
  );

  return {
    ok: tfOk > 0,
    symbol: sym,
    tfOk,
    boxes: totalBoxes,
    error: scanError ?? undefined,
  };
}
