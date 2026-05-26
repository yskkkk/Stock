import fs from "node:fs";
import path from "node:path";
import {
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_CATALOG_DIR_PINE,
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  BOX_RANGE_CRYPTO_HTF_TIMEFRAMES,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";
import {
  catalogDirForRoot,
  refreshCatalogIndexSync,
  resolveCatalogRootDir,
  writeSymbolCatalogSync,
} from "./catalog-store.js";
import { readBoxRangeStoreSync, writeBoxRangeStoreSync } from "./store.js";
import { liveTradeLogInfo } from "../live-trade-log.js";

function isCryptoUsdtSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase().endsWith("-USDT");
}

/**
 * crypto 카탈로그·실행 박스에서 1h/4h/1d 비트·이더 외 종목 제거
 * @returns {{ catalogFilesRemoved: number; catalogBoxesRemoved: number; tradingBoxesClosed: number }}
 */
export function purgeBoxRangeCryptoOutsideHtfSymbolsSync() {
  let catalogFilesRemoved = 0;
  let catalogBoxesRemoved = 0;
  let tradingBoxesClosed = 0;

  const roots = [
    resolveCatalogRootDir(),
    BOX_RANGE_CATALOG_DIR_PINE,
    BOX_RANGE_CATALOG_DIR_LEGACY,
  ].filter((v, i, a) => a.indexOf(v) === i);

  for (const root of roots) {
    const dir = catalogDirForRoot("crypto", root);
    if (!fs.existsSync(dir)) continue;

    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json") || f === "_index.json") continue;
      const sym = f.replace(/\.json$/i, "").toUpperCase();
      const file = path.join(dir, f);

      if (!isBoxRangeCryptoHtfSymbol(sym)) {
        try {
          fs.unlinkSync(file);
          catalogFilesRemoved += 1;
        } catch {
          /* ignore */
        }
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!raw || typeof raw !== "object" || !Array.isArray(raw.boxes)) continue;
        const before = raw.boxes.length;
        const boxes = raw.boxes.filter((b) => {
          const tf = String(b?.timeframe ?? "").trim();
          return isBoxRangeCryptoHtfManaged(sym, tf);
        });
        catalogBoxesRemoved += before - boxes.length;
        if (boxes.length !== before) {
          writeSymbolCatalogSync(
            {
              symbol: sym,
              name: String(raw.name ?? sym),
              updatedAtMs: Number(raw.updatedAtMs) || Date.now(),
              scanError: raw.scanError ?? null,
              boxes,
            },
            "crypto",
            root,
          );
        }
      } catch {
        /* ignore */
      }
    }

    try {
      refreshCatalogIndexSync("crypto", root);
    } catch {
      /* ignore */
    }
  }

  const store = readBoxRangeStoreSync();
  const now = Date.now();
  let changed = false;
  for (let i = 0; i < store.boxes.length; i++) {
    const b = store.boxes[i];
    const sym = String(b.symbol ?? "").trim().toUpperCase();
    const tf = String(b.timeframe ?? "").trim();
    const crypto =
      b.catalogMarket === "crypto" ||
      (!b.catalogMarket && isCryptoUsdtSymbol(sym));
    if (!crypto) continue;
    if (isBoxRangeCryptoHtfManaged(sym, tf)) continue;

    store.boxes[i] = {
      ...b,
      state: "closed",
      tradeEligible: false,
      lotQty: 0,
      buyTradeId: null,
      entryPrice: null,
      buyAtMs: null,
      updatedAtMs: now,
    };
    tradingBoxesClosed += 1;
    changed = true;
  }
  if (changed) writeBoxRangeStoreSync(store);

  if (
    catalogFilesRemoved > 0 ||
    catalogBoxesRemoved > 0 ||
    tradingBoxesClosed > 0
  ) {
    liveTradeLogInfo("[box-range:crypto-htf-purge]", {
      catalogFilesRemoved,
      catalogBoxesRemoved,
      tradingBoxesClosed,
      allowed: BOX_RANGE_CRYPTO_HTF_SYMBOLS,
      timeframes: BOX_RANGE_CRYPTO_HTF_TIMEFRAMES,
    });
  }

  return { catalogFilesRemoved, catalogBoxesRemoved, tradingBoxesClosed };
}
