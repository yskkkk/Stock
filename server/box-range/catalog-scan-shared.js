import { loadStock } from "../stock-data.js";
import {
  BOX_RANGE_CATALOG_DIR_PRO,
  BOX_RANGE_CATALOG_DIR_V2,
  BOX_RANGE_PINE_MAX_STORE,
  BOX_RANGE_PRO_TIMEFRAMES,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";
import {
  detectCatalogBoxesForTimeframe,
  detectCatalogBoxesV2ForTimeframe,
} from "./catalog-detect.js";
import {
  upsertSymbolCatalogDetectionsSync,
} from "./catalog-store.js";
import { normalizeBoxUnixTime } from "./box-time.js";

/**
 * @param {string} symbol
 * @param {"1h"|"4h"|"1d"} timeframe
 */
export async function loadCandlesForBoxScan(symbol, timeframe) {
  try {
    const data = await loadStock(symbol, timeframe, {
      live: true,
      boxRangeScan: true,
    });
    const candles = Array.isArray(data?.candles) ? data.candles : [];
    return candles
      .map((c) => {
        if (!c) return null;
        const time = normalizeBoxUnixTime(c.time);
        if (time == null || !Number.isFinite(c.high) || !Number.isFinite(c.low)) {
          return null;
        }
        const vol = Number(c.volume);
        return {
          ...c,
          time,
          volume: Number.isFinite(vol) && vol > 0 ? vol : undefined,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * PRO v2 — 4h·1d만 카탈로그 저장 (1h 전용은 추후 별도)
 * @param {{ symbol: string; name: string }} item
 * @param {"us"|"kr"|"crypto"} catalogMarket
 */
export async function scanOneSymbolCatalog(item, catalogMarket) {
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  if (!sym) return { ok: false, symbol: sym, error: "empty symbol" };
  if (catalogMarket === "crypto" && !isBoxRangeCryptoHtfSymbol(sym)) {
    return { ok: false, symbol: sym, error: "crypto HTF: BTC·ETH only" };
  }
  /** @type {Partial<Record<"1h"|"4h"|"1d", import("./box-range-pro-core.js").DetectedBox[]>>} */
  const byTf = {};
  let tfOk = 0;
  let totalBoxes = 0;
  /** @type {string[]} */
  const tfErrors = [];

  for (const tf of BOX_RANGE_PRO_TIMEFRAMES) {
    try {
      const candles = await loadCandlesForBoxScan(sym, tf);
      if (candles.length < 20) {
        byTf[tf] = [];
        continue;
      }
      tfOk += 1;
      byTf[tf] = detectCatalogBoxesForTimeframe(
        candles,
        tf,
        BOX_RANGE_PINE_MAX_STORE,
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
        : "봉 데이터 없음(4h·1d)"
      : null;

  upsertSymbolCatalogDetectionsSync(
    sym,
    item.name ?? sym,
    byTf,
    scanError,
    catalogMarket,
    BOX_RANGE_CATALOG_DIR_PRO,
  );

  return {
    ok: tfOk > 0,
    symbol: sym,
    tfOk,
    boxes: totalBoxes,
    error: scanError ?? undefined,
  };
}

/**
 * V2 탐지(ER필터+POC) — 기존 PRO 스캔과 별도로 box-range-catalog-v2 에 저장
 * @param {{ symbol: string; name: string }} item
 * @param {"us"|"kr"|"crypto"} catalogMarket
 */
export async function scanOneSymbolCatalogV2(item, catalogMarket) {
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  if (!sym) return { ok: false, symbol: sym, error: "empty symbol" };
  if (catalogMarket === "crypto" && !isBoxRangeCryptoHtfSymbol(sym)) {
    return { ok: false, symbol: sym, error: "crypto HTF: BTC·ETH·SOL only" };
  }
  /** @type {Partial<Record<"1h"|"4h"|"1d", import("./box-range-pro-core.js").DetectedBox[]>>} */
  const byTf = {};
  let tfOk = 0;
  let totalBoxes = 0;
  /** @type {string[]} */
  const tfErrors = [];

  for (const tf of BOX_RANGE_PRO_TIMEFRAMES) {
    try {
      const candles = await loadCandlesForBoxScan(sym, tf);
      if (candles.length < 20) {
        byTf[tf] = [];
        continue;
      }
      tfOk += 1;
      byTf[tf] = detectCatalogBoxesV2ForTimeframe(
        candles,
        tf,
        BOX_RANGE_PINE_MAX_STORE,
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
    BOX_RANGE_CATALOG_DIR_V2,
  );

  return {
    ok: tfOk > 0,
    symbol: sym,
    tfOk,
    boxes: totalBoxes,
    detectedByTf: Object.fromEntries(
      Object.entries(byTf).map(([tf, boxes]) => [tf, boxes.length]),
    ),
    error: scanError ?? undefined,
  };
}
