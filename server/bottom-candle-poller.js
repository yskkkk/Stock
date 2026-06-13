import { randomUUID } from "node:crypto";
import { getKstParts } from "./kr-business-day.js";
import { runBottomCandleMarketScan, getBottomCandleScanStateSync } from "./bottom-candle-scan.js";
import {
  clearBottomCandleVaultItemsSync,
  mergeBottomCandleHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { VAULT_SCAN_TIMEFRAMES } from "./vault-scan-timeframe.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_BOTTOM_CANDLE_POLL_MS ?? 3_600_000);
  return Number.isFinite(n) && n >= 300_000 ? Math.min(n, 86_400_000) : 3_600_000;
})();

let manualScanRunning = false;
let scheduledScanRunning = false;
/** @type {{ atMs: number; results: Array<{ market: "kr"|"us"; timeframe: string; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function bottomCandleScanEnabled() {
  return String(process.env.STOCK_BOTTOM_CANDLE_SCAN ?? "1").trim() !== "0";
}

export function isBottomCandleManualScanRunning() {
  return manualScanRunning;
}

export function getLastBottomCandleManualScanResult() {
  return lastManualScanResult;
}

/**
 * @param {Date} [now]
 */
function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {import("./vault-scan-timeframe.js").VaultScanTimeframe} timeframe
 */
async function runMarketTimeframeScan(market, scanDate, timeframe) {
  clearBottomCandleVaultItemsSync({ market, timeframe });
  const result = await runBottomCandleMarketScan(market, scanDate, {
    timeframe,
    persistState: true,
  });
  if (result.hits.length) {
    mergeBottomCandleHitsIntoVaultSync(result.hits);
  }
  return result;
}

/** @param {Date} [now] @param {"manual"|"scheduled"} trigger */
async function runFullBottomCandleScanInternal(now = new Date(), trigger = "scheduled") {
  const runId = randomUUID();
  /** @type {Array<{ market: "kr"|"us"; timeframe: string; scanDate: string; scanned: number; hitCount: number }>} */
  const results = [];

  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
    for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
      try {
        const result = await runMarketTimeframeScan(market, scanDate, timeframe);
        results.push({
          market,
          timeframe,
          scanDate,
          scanned: result.scanned,
          hitCount: result.hitCount,
        });
        liveTradeLogInfo("[bottom-candle:scan:done]", {
          runId,
          trigger,
          market,
          timeframe,
          hitCount: result.hitCount,
          scanned: result.scanned,
        });
      } catch (e) {
        liveTradeLogWarn(
          "[bottom-candle:scan]",
          market,
          timeframe,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  lastManualScanResult = { atMs: Date.now(), results };
  return lastManualScanResult;
}

/** @returns {{ started: boolean; reason?: string }} */
export function triggerBottomCandleManualScan() {
  if (!bottomCandleScanEnabled()) {
    return { started: false, reason: "disabled" };
  }
  if (manualScanRunning || scheduledScanRunning) {
    return { started: false, reason: "busy" };
  }
  manualScanRunning = true;
  void runFullBottomCandleScanInternal(new Date(), "manual")
    .catch((e) => {
      liveTradeLogWarn(
        "[bottom-candle:manual]",
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      manualScanRunning = false;
    });
  return { started: true };
}

export function startBottomCandleScanPoller() {
  if (!bottomCandleScanEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockBottomCandleScan?: boolean }} */ (
    globalThis
  );
  if (g.__stockBottomCandleScan) return;
  g.__stockBottomCandleScan = true;
  markPollerBootStarted("bottom-candle");

  let running = false;
  const tick = () => {
    if (running || manualScanRunning) return;
    running = true;
    scheduledScanRunning = true;
    void pollerGuardAsync("bottom-candle", async () => {
      await runFullBottomCandleScanInternal(new Date(), "scheduled");
    })
      .catch((e) => {
        liveTradeLogWarn(
          "[bottom-candle:poller]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
        scheduledScanRunning = false;
      });
  };

  liveTradeLogInfo("[bottom-candle:poller] start", { pollMs: POLL_MS });
  setTimeout(tick, 45_000);
  setInterval(tick, POLL_MS);
}

export { getBottomCandleScanStateSync };
