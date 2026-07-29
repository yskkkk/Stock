import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { getKstParts } from "./kr-business-day.js";
import {
  runBottomCandleMarketScan,
  getBottomCandleScanStateSync,
  wasBottomCandleScannedSync,
} from "./bottom-candle-scan.js";
import {
  isKrMarketFullyClosed,
  isUsMarketFullyClosed,
} from "./golden-cross-poller.js";
import {
  assessScanVaultMerge,
  applyVaultScanMerge,
} from "./scan-vault-merge.js";
import {
  clearBottomCandleVaultItemsSync,
  mergeBottomCandleHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { VAULT_SCAN_TIMEFRAMES } from "./vault-scan-timeframe.js";
import {
  notifyBottomCandleScanDoneTelegram,
  notifyBottomCandleScanStartTelegram,
} from "./golden-cross-telegram.js";
import {
  queueScanReportEmail,
  endScanReportCoalesceWindow,
} from "./notifications/scan-report-email-coalesce.js";
import {
  beginVaultScanProgressSession,
  endVaultScanProgressSession,
  vaultScanProgressReporter,
} from "./vault-scan-progress.js";

// 골든크로스와 동일한 폴링 주기(기본 5분) — 매시간 무조건 반복하지 않고
// tick마다 «장 완전 마감 + 이 세션 미스캔» 조건일 때만 실제 스캔.
const POLL_MS = (() => {
  const n = Number(
    process.env.STOCK_BOTTOM_CANDLE_POLL_MS ??
      process.env.STOCK_GOLDEN_CROSS_POLL_MS ??
      300_000,
  );
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 86_400_000) : 300_000;
})();

let manualScanRunning = false;
let scheduledScanRunning = false;
/** @type {{ atMs: number; results: Array<{ market: "kr"|"us"; timeframe: string; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function bottomCandleScanEnabled() {
  return String(process.env.STOCK_BOTTOM_CANDLE_SCAN ?? "1").trim() !== "0";
}

/**
 * 골든크로스와 동일한 스캔 due 판정 — 장이 **완전 마감**되었고 그 세션(날짜)의
 * 일봉·주봉을 아직 안 돌렸을 때만 true. 장중·주말·휴장·이미 스캔한 세션은 false.
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function shouldRunBottomCandleScan(market, now = new Date()) {
  if (!bottomCandleScanEnabled()) return false;
  const dateKey =
    market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
  for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
    if (!wasBottomCandleScannedSync(market, dateKey, timeframe)) {
      return market === "kr"
        ? isKrMarketFullyClosed(now)
        : isUsMarketFullyClosed(now);
    }
  }
  return false;
}

export function isBottomCandleManualScanRunning() {
  return manualScanRunning;
}

export function isBottomCandleScanRunning() {
  return manualScanRunning || scheduledScanRunning;
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
  const result = await runBottomCandleMarketScan(market, scanDate, {
    timeframe,
    persistState: true,
    onProgress: vaultScanProgressReporter("bottom_candle", market, timeframe),
  });
  const merge = applyVaultScanMerge(
    assessScanVaultMerge({
      scanned: result.scanned,
      hitCount: result.hitCount,
      errors: result.errors ?? 0,
    }),
    {
      clear: () => clearBottomCandleVaultItemsSync({ market, timeframe }),
      merge: (hits) =>
        mergeBottomCandleHitsIntoVaultSync(/** @type {typeof result.hits} */ (hits)),
    },
    result.hits,
  );
  return { ...result, mergeOutcome: merge.outcome };
}

/**
 * @param {Date} [now]
 * @param {"manual"|"scheduled"} trigger
 * @param {Array<"kr"|"us">} [markets] — 스캔 대상 시장(기본 kr·us 모두)
 */
export async function runFullBottomCandleScanInternal(
  now = new Date(),
  trigger = "scheduled",
  markets = ["kr", "us"],
) {
  const runId = randomUUID();
  const kstDate = getKstParts(now).dateKey;
  const startedAt = performance.now();
  await notifyBottomCandleScanStartTelegram({
    trigger,
    scanDate: kstDate,
  }).catch(() => {});
  beginVaultScanProgressSession(runId);
  try {
  /** @type {Array<{ market: "kr"|"us"; timeframe: string; scanDate: string; scanned: number; hitCount: number }>} */
  const results = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").BottomCandleEmailMarket[]} */
  const bottomCandleEmailMarkets = [];
  /** @type {import("./golden-cross-telegram.js").VaultScanTimingRow[]} */
  const timings = [];

  for (const market of markets) {
    const scanDate =
      market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
    for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
      const t0 = performance.now();
      try {
        const result = await runMarketTimeframeScan(market, scanDate, timeframe);
        bottomCandleEmailMarkets.push({
          market,
          scanDate,
          timeframe,
          scanned: result.scanned,
          hits: result.hits,
        });
        timings.push({
          market,
          timeframe,
          kind: "bottomCandle",
          durationMs: performance.now() - t0,
          hitCount: result.hitCount,
          ok: true,
        });
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
          errors: result.errors ?? 0,
          mergeOutcome: result.mergeOutcome,
        });
      } catch (e) {
        timings.push({
          market,
          timeframe,
          kind: "bottomCandle",
          durationMs: performance.now() - t0,
          ok: false,
        });
        liveTradeLogWarn(
          "[bottom-candle:scan]",
          market,
          timeframe,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  try {
    await queueScanReportEmail({
      bottomCandle: bottomCandleEmailMarkets,
    });
    endScanReportCoalesceWindow();
    liveTradeLogInfo("[bottom-candle:scan:email]", { queued: true, coalesced: true });
  } catch (e) {
    liveTradeLogWarn(
      "[bottom-candle:scan:email]",
      e instanceof Error ? e.message : e,
    );
  }

  await notifyBottomCandleScanDoneTelegram({
    trigger,
    scanDate: kstDate,
    totalDurationMs: performance.now() - startedAt,
    rows: timings,
  }).catch(() => {});

  lastManualScanResult = { atMs: Date.now(), results };
  return lastManualScanResult;
  } finally {
    endVaultScanProgressSession();
  }
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

const BC_WORKER_URL = new URL("./bottom-candle-scan-worker.js", import.meta.url);

/**
 * 바닥봉 스캔을 별도 Worker Thread에서 실행
 * @param {Array<"kr"|"us">} [markets] — due 시장만 스캔(기본 kr·us)
 */
function spawnBottomCandleScanWorker(markets = ["kr", "us"]) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(BC_WORKER_URL, {
      workerData: { trigger: "scheduled", markets },
    });
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.once("error", (err) => reject(err));
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`[bottom-candle:poller] worker exit ${code}`));
    });
  });
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
    try {
      if (running || manualScanRunning) return;
      const now = new Date();
      const dueMarkets = /** @type {Array<"kr"|"us">} */ (["kr", "us"]).filter(
        (m) => shouldRunBottomCandleScan(m, now),
      );
      if (!dueMarkets.length) return;
      running = true;
      scheduledScanRunning = true;
      void pollerGuardAsync("bottom-candle", () => spawnBottomCandleScanWorker(dueMarkets))
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
    } catch (e) {
      running = false;
      scheduledScanRunning = false;
      liveTradeLogWarn(
        "[bottom-candle:poller:tick]",
        e instanceof Error ? e.message : e,
      );
    }
  };

  liveTradeLogInfo("[bottom-candle:poller] start", { pollMs: POLL_MS });
  setTimeout(tick, 45_000);
  const _iv = setInterval(tick, POLL_MS);
  void _iv;
}

export { getBottomCandleScanStateSync };
