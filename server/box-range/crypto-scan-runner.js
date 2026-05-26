import { cryptoYahooUsdtDisplayName } from "../crypto-display-names.js";
import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  BOX_RANGE_CRYPTO_SCAN_MS,
} from "./constants.js";
import { scanOneSymbolCatalog } from "./catalog-scan-shared.js";
import { refreshCatalogIndexSync } from "./catalog-store.js";
import { notifyCatalogScanTelegram } from "./catalog-scan-telegram.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

/** @returns {{ symbol: string; name: string }[]} */
export function boxRangeCryptoCatalogItems() {
  return BOX_RANGE_CRYPTO_HTF_SYMBOLS.map((symbol) => ({
    symbol,
    name: cryptoYahooUsdtDisplayName(symbol),
  }));
}

/** @returns {{ symbol: string; name: string }} */
export function boxRangeCryptoCatalogItem() {
  return boxRangeCryptoCatalogItems()[0];
}

export async function runCryptoBoxRangeCatalogScan() {
  const items = boxRangeCryptoCatalogItems();
  liveTradeLogInfo(
    "[box-range:crypto-scan] start",
    items.map((i) => i.symbol).join(","),
  );

  let ok = 0;
  let errors = 0;
  let withBoxes = 0;
  let boxes = 0;
  /** @type {string[]} */
  const scanErrors = [];

  for (const item of items) {
    const r = await scanOneSymbolCatalog(item, "crypto");
    if (r.ok) ok += 1;
    else {
      errors += 1;
      if (r.error) scanErrors.push(`${item.symbol}:${r.error}`);
    }
    if (r.boxes > 0) withBoxes += 1;
    boxes += r.boxes;
  }
  refreshCatalogIndexSync("crypto");

  const out = {
    scanned: items.length,
    ok,
    errors,
    withBoxes,
    boxes,
    error: scanErrors.length ? scanErrors.join("; ") : undefined,
  };
  liveTradeLogInfo("[box-range:crypto-scan] done", out);
  await notifyCatalogScanTelegram("crypto", out).catch((e) => {
    liveTradeLogWarn(
      "[box-range:crypto-scan:telegram]",
      e instanceof Error ? e.message : e,
    );
  });
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
