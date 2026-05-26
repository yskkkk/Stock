import { loadUniverse } from "../universe.js";
import { BOX_RANGE_SP500_SCAN_MS } from "./constants.js";
import { scanOneSymbolCatalog } from "./catalog-scan-shared.js";
import { refreshCatalogIndexSync } from "./catalog-store.js";
import { notifyCatalogScanTelegram } from "./catalog-scan-telegram.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SP500_BATCH ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 12) : 4;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_SP500_BATCH_DELAY_MS ?? 400);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 400;
})();

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runSp500BoxRangeCatalogScan() {
  const uni = await loadUniverse();
  const list = Array.isArray(uni?.us) ? uni.us : [];
  if (!list.length) {
    liveTradeLogWarn("[box-range:sp500-scan] universe.us empty");
    return { scanned: 0, errors: 0, ok: 0, withBoxes: 0 };
  }

  let ok = 0;
  let errors = 0;
  let withBoxes = 0;
  liveTradeLogInfo("[box-range:sp500-scan] start", list.length, "symbols");

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbolCatalog(item, "us")),
    );
    for (const r of results) {
      if (r.ok) ok += 1;
      else errors += 1;
      if (r.boxes > 0) withBoxes += 1;
    }
    if (i + BATCH_SIZE < list.length && BATCH_DELAY_MS > 0) {
      await delay(BATCH_DELAY_MS);
    }
  }

  refreshCatalogIndexSync("us");
  const result = { scanned: list.length, ok, errors, withBoxes };
  liveTradeLogInfo("[box-range:sp500-scan] done", {
    ...result,
    total: list.length,
  });
  await notifyCatalogScanTelegram("us", result).catch((e) => {
    liveTradeLogWarn(
      "[box-range:sp500-scan:telegram]",
      e instanceof Error ? e.message : e,
    );
  });
  return result;
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
