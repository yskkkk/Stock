import { loadUniverse } from "../universe.js";
import { BOX_RANGE_KR_SCAN_MS } from "./constants.js";
import { scanOneSymbolCatalog } from "./catalog-scan-shared.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "../live-trade-log.js";

const BATCH_SIZE = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_KR_BATCH ?? 6);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 6;
})();

const BATCH_DELAY_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_KR_BATCH_DELAY_MS ?? 300);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5_000) : 300;
})();

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runKrBoxRangeCatalogScan() {
  const uni = await loadUniverse();
  const list = Array.isArray(uni?.kr) ? uni.kr : [];
  if (!list.length) {
    liveTradeLogWarn("[box-range:kr-scan] universe.kr empty");
    return { scanned: 0, errors: 0, ok: 0, withBoxes: 0 };
  }

  let ok = 0;
  let errors = 0;
  let withBoxes = 0;
  liveTradeLogInfo("[box-range:kr-scan] start", list.length, "symbols");

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((item) => scanOneSymbolCatalog(item, "kr")),
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

  liveTradeLogInfo("[box-range:kr-scan] done", {
    ok,
    errors,
    withBoxes,
    total: list.length,
  });
  return { scanned: list.length, ok, errors, withBoxes };
}

export function startKrBoxRangeCatalogPoller() {
  if (process.env.STOCK_BOX_RANGE_KR_SCAN === "0") return;
  const g = /** @type {typeof globalThis & { __stockBoxRangeKrScan?: boolean }} */ (
    globalThis
  );
  if (g.__stockBoxRangeKrScan) return;
  g.__stockBoxRangeKrScan = true;

  let running = false;
  const loop = () => {
    if (running) return;
    running = true;
    runKrBoxRangeCatalogScan()
      .catch((e) => {
        liveTradeLogWarn(
          "[box-range:kr-scan]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  loop();
  setInterval(loop, BOX_RANGE_KR_SCAN_MS);
}
