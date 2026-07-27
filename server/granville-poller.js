import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import {
  getKstParts,
  isKrBusinessDay,
  previousKrBusinessDay,
  shiftDateKey,
} from "./kr-business-day.js";
import {
  runGranvilleMarketScan,
  getGranvilleScanStateSync,
  wasGranvilleScannedSync,
} from "./granville-scan.js";
import {
  assessScanVaultMerge,
  applyVaultScanMerge,
} from "./scan-vault-merge.js";
import {
  clearGranvilleVaultItemsSync,
  mergeGranvilleHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";

// 골든크로스와 동일한 폴링 주기(기본 5분) — tick마다 «정규장 마감 세션 미스캔»
// 조건일 때만 실제 스캔. 서버 부팅 시 직전 거래일이 비어 있으면 그 세션을 백필.
const POLL_MS = (() => {
  const n = Number(
    process.env.STOCK_GRANVILLE_POLL_MS ??
      process.env.STOCK_GOLDEN_CROSS_POLL_MS ??
      300_000,
  );
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 86_400_000) : 300_000;
})();

/** KR 정규장 마감 15:30 KST */
const KR_REGULAR_CLOSE_MIN = 15 * 60 + 30;
/** US 정규장 마감 16:00 ET */
const US_REGULAR_CLOSE_MIN = 16 * 60;

let manualScanRunning = false;
let scheduledScanRunning = false;
/** @type {{ atMs: number; results: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function granvilleScanEnabled() {
  return String(process.env.STOCK_GRANVILLE_SCAN ?? "1").trim() !== "0";
}

/** @param {Date} [now] */
function usEtParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey,
  };
}

/** @param {string} dateKey */
function isUsWeekend(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** @param {string} dateKey */
function previousUsBusinessDay(dateKey) {
  let cur = shiftDateKey(dateKey, -1);
  for (let i = 0; i < 10; i++) {
    if (!isUsWeekend(cur)) return cur;
    cur = shiftDateKey(cur, -1);
  }
  return cur;
}

/**
 * 가장 최근 «정규장 마감이 완료된» 거래일 dateKey. 장중·마감 전·휴장이면 직전 거래일.
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 * @returns {string}
 */
export function finishedRegularSession(market, now = new Date()) {
  if (market === "kr") {
    const kst = getKstParts(now);
    if (isKrBusinessDay(kst.dateKey) && kst.minutesOfDay >= KR_REGULAR_CLOSE_MIN) {
      return kst.dateKey;
    }
    return previousKrBusinessDay(kst.dateKey);
  }
  const et = usEtParts(now);
  if (!isUsWeekend(et.dateKey) && et.minutes >= US_REGULAR_CLOSE_MIN) {
    return et.dateKey;
  }
  return previousUsBusinessDay(et.dateKey);
}

/**
 * 스캔해야 할 세션 날짜(미스캔 상태)면 그 dateKey, 아니면 null.
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 * @returns {string|null}
 */
export function dueGranvilleScanDate(market, now = new Date()) {
  if (!granvilleScanEnabled()) return null;
  const session = finishedRegularSession(market, now);
  if (!session) return null;
  if (wasGranvilleScannedSync(market, session)) return null;
  return session;
}

export function isGranvilleManualScanRunning() {
  return manualScanRunning;
}

export function isGranvilleScanRunning() {
  return manualScanRunning || scheduledScanRunning;
}

export function getLastGranvilleManualScanResult() {
  return lastManualScanResult;
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 */
async function runMarketScan(market, scanDate) {
  const result = await runGranvilleMarketScan(market, scanDate, {
    persistState: true,
  });
  const merge = applyVaultScanMerge(
    assessScanVaultMerge({
      scanned: result.scanned,
      hitCount: result.hitCount,
      errors: result.errors ?? 0,
    }),
    {
      clear: () => clearGranvilleVaultItemsSync({ market }),
      merge: (hits) =>
        mergeGranvilleHitsIntoVaultSync(/** @type {typeof result.hits} */ (hits)),
    },
    result.hits,
  );
  return { ...result, mergeOutcome: merge.outcome };
}

/**
 * @param {Date} [now]
 * @param {"manual"|"scheduled"} [trigger]
 * @param {Array<"kr"|"us">} [markets]
 */
export async function runFullGranvilleScanInternal(
  now = new Date(),
  trigger = "scheduled",
  markets = ["kr", "us"],
) {
  const runId = randomUUID();
  const startedAt = performance.now();
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const results = [];

  for (const market of markets) {
    const scanDate = finishedRegularSession(market, now);
    try {
      const result = await runMarketScan(market, scanDate);
      results.push({
        market,
        scanDate,
        scanned: result.scanned,
        hitCount: result.hitCount,
      });
      liveTradeLogInfo("[granville:scan:done]", {
        runId,
        trigger,
        market,
        scanDate,
        hitCount: result.hitCount,
        scanned: result.scanned,
        errors: result.errors ?? 0,
        mergeOutcome: result.mergeOutcome,
      });
    } catch (e) {
      liveTradeLogWarn("[granville:scan]", market, e instanceof Error ? e.message : e);
    }
  }

  liveTradeLogInfo("[granville:scan:all]", {
    runId,
    trigger,
    durationMs: performance.now() - startedAt,
    markets: results.length,
  });
  lastManualScanResult = { atMs: Date.now(), results };
  return lastManualScanResult;
}

/** @returns {{ started: boolean; reason?: string }} */
export function triggerGranvilleManualScan() {
  if (!granvilleScanEnabled()) return { started: false, reason: "disabled" };
  if (manualScanRunning || scheduledScanRunning) {
    return { started: false, reason: "busy" };
  }
  manualScanRunning = true;
  void runFullGranvilleScanInternal(new Date(), "manual")
    .catch((e) => {
      liveTradeLogWarn("[granville:manual]", e instanceof Error ? e.message : e);
    })
    .finally(() => {
      manualScanRunning = false;
    });
  return { started: true };
}

const GRANVILLE_WORKER_URL = new URL("./granville-scan-worker.js", import.meta.url);

/**
 * @param {Array<"kr"|"us">} [markets]
 */
function spawnGranvilleScanWorker(markets = ["kr", "us"]) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(GRANVILLE_WORKER_URL, {
      workerData: { trigger: "scheduled", markets },
    });
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.once("error", (err) => reject(err));
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`[granville:poller] worker exit ${code}`));
    });
  });
}

export function startGranvilleScanPoller() {
  if (!granvilleScanEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockGranvilleScan?: boolean }} */ (
    globalThis
  );
  if (g.__stockGranvilleScan) return;
  g.__stockGranvilleScan = true;
  markPollerBootStarted("granville");

  let running = false;
  const tick = () => {
    try {
      if (running || manualScanRunning) return;
      const now = new Date();
      const dueMarkets = /** @type {Array<"kr"|"us">} */ (["kr", "us"]).filter(
        (m) => dueGranvilleScanDate(m, now) != null,
      );
      if (!dueMarkets.length) return;
      running = true;
      scheduledScanRunning = true;
      void pollerGuardAsync("granville", () => spawnGranvilleScanWorker(dueMarkets))
        .catch((e) => {
          liveTradeLogWarn("[granville:poller]", e instanceof Error ? e.message : e);
        })
        .finally(() => {
          running = false;
          scheduledScanRunning = false;
        });
    } catch (e) {
      liveTradeLogWarn("[granville:poller:tick]", e instanceof Error ? e.message : e);
    }
  };

  liveTradeLogInfo("[granville:poller] start", { pollMs: POLL_MS, maPeriod: Number(process.env.STOCK_GRANVILLE_MA_PERIOD ?? 200) });
  // 부팅 직후 한 번(백필 포함) — 다른 스캔 워커와 겹치지 않도록 약간 지연
  setTimeout(tick, 60_000);
  const _iv = setInterval(tick, POLL_MS);
  void _iv;
}

export { getGranvilleScanStateSync };
