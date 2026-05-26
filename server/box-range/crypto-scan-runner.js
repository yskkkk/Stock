import { cryptoYahooUsdtDisplayName } from "../crypto-display-names.js";
import {
  BOX_RANGE_CRYPTO_CATALOG_SYMBOL,
  BOX_RANGE_CRYPTO_SCAN_MS,
} from "./constants.js";
import { scanOneSymbolCatalog } from "./catalog-scan-shared.js";
import { refreshCatalogIndexSync } from "./catalog-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

/** @returns {{ symbol: string; name: string }} */
export function boxRangeCryptoCatalogItem() {
  const symbol = BOX_RANGE_CRYPTO_CATALOG_SYMBOL;
  return {
    symbol,
    name: cryptoYahooUsdtDisplayName(symbol),
  };
}

export async function runCryptoBoxRangeCatalogScan() {
  const item = boxRangeCryptoCatalogItem();
  liveTradeLogInfo("[box-range:crypto-scan] start", item.symbol);

  const r = await scanOneSymbolCatalog(item, "crypto");
  refreshCatalogIndexSync("crypto");

  const out = {
    scanned: 1,
    ok: r.ok ? 1 : 0,
    errors: r.ok ? 0 : 1,
    withBoxes: r.boxes > 0 ? 1 : 0,
    boxes: r.boxes,
    error: r.error,
  };
  liveTradeLogInfo("[box-range:crypto-scan] done", out);
  return out;
}

export function startCryptoBoxRangeCatalogPoller() {
  if (process.env.STOCK_BOX_RANGE_CRYPTO_SCAN === "0") return;
  const g = /** @type {typeof globalThis & { __stockBoxRangeCryptoScan?: boolean }} */ (
    globalThis
  );
  if (g.__stockBoxRangeCryptoScan) return;
  g.__stockBoxRangeCryptoScan = true;

  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    runCryptoBoxRangeCatalogScan()
      .catch((e) => {
        liveTradeLogWarn(
          "[box-range:crypto-scan]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  loop();
  setInterval(loop, BOX_RANGE_CRYPTO_SCAN_MS);
}
