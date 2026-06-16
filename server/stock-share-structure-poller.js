/**
 * 주식 수량 캐시 — KST 00:00·12:00 일괄 갱신
 */
import { appendServerEventLog } from "./access-log.js";
import { readJsonStoreSync } from "./store-json.js";
import {
  refreshAllCachedShareStructures,
  shouldRunShareStructureBulkRefresh,
} from "./stock-share-structure.js";

const STORE_FILE = "stock-share-structure.json";
const TICK_MS = 60_000;

/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** @type {Promise<void> | null} */
let inFlight = null;

function readLastBulkSlot() {
  try {
    const raw = readJsonStoreSync(
      STORE_FILE,
      (data) =>
        data && typeof data === "object" && typeof data.lastBulkRefreshSlot === "string"
          ? data.lastBulkRefreshSlot
          : null,
      () => null,
    );
    return raw;
  } catch {
    return null;
  }
}

async function tick() {
  if (inFlight) return;
  const last = readLastBulkSlot();
  if (!shouldRunShareStructureBulkRefresh(last)) return;
  inFlight = (async () => {
    try {
      const result = await refreshAllCachedShareStructures();
      appendServerEventLog(
        "share-structure",
        `일괄 갱신 ${result.updated}/${result.symbols} (${result.slot})`,
      );
    } catch (err) {
      console.warn(
        "[share-structure]",
        err instanceof Error ? err.message : err,
      );
    } finally {
      inFlight = null;
    }
  })();
  await inFlight;
}

export function startStockShareStructurePoller() {
  if (timer != null) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
