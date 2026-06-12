import { randomUUID } from "node:crypto";
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { runGoldenCrossMarketScan, wasGoldenCrossScannedSync } from "./golden-cross-scan.js";
import { runMaAlignMarketScan, wasMaAlignScannedSync } from "./ma-align-scan.js";
import { runMa120NearMarketScan, wasMa120NearScannedSync } from "./ma120-near-scan.js";
import {
  clearGoldenCrossVaultItemsSync,
  clearMaAlignVaultItemsSync,
  clearMa120NearVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  mergeMaAlignHitsIntoVaultSync,
  mergeMa120NearHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { appendGoldenCrossHistoryEntrySync } from "./golden-cross-history-store.js";
import { appendMaAlignHistoryEntrySync } from "./ma-align-history-store.js";
import { appendMa120NearHistoryEntrySync } from "./ma120-near-history-store.js";
import { notifyGoldenCrossScanTelegram, notifyVaultTimeframeIntersectionTelegram } from "./golden-cross-telegram.js";
import { sendGoldenCrossScanReportEmail, buildScanEmailPayloadFromVaultResult } from "./notifications/golden-cross-scan-email.js";
import { runMaAlignVaultIntradayRefresh } from "./ma-align-vault-intraday.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { isStockTradableBySchedule } from "./market-hours.js";
import { VAULT_SCAN_TIMEFRAMES } from "./vault-scan-timeframe.js";
import { buildMarketTimeframeIntersections } from "./vault-scan-intersection.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_GOLDEN_CROSS_POLL_MS ?? 300_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 900_000) : 300_000;
})();

const INTRADAY_RESCAN_MS = (() => {
  const n = Number(process.env.STOCK_VAULT_INTRADAY_RESCAN_MS ?? 180_000);
  return Number.isFinite(n) && n >= 30_000 ? Math.min(n, 3_600_000) : 180_000;
})();

const INTRADAY_TICK_MS = (() => {
  const n = Number(process.env.STOCK_VAULT_INTRADAY_TICK_MS ?? 90_000);
  return Number.isFinite(n) && n >= 15_000 ? Math.min(n, 300_000) : 90_000;
})();

/** KR 장후 시간외 종료 18:00 KST */
const KR_FULL_CLOSE_MIN = 18 * 60;
/** US 애프터마켓 종료 20:00 ET */
const US_FULL_CLOSE_MIN = 20 * 60;

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
function localMinutesOfDay(market, now = new Date()) {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey: new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
  };
}

/** @param {Date} [now] */
export function isKrMarketFullyClosed(now = new Date()) {
  const kst = getKstParts(now);
  if (!isKrBusinessDay(kst.dateKey)) return false;
  return kst.minutesOfDay >= KR_FULL_CLOSE_MIN;
}

/** @param {Date} [now] */
export function isUsMarketFullyClosed(now = new Date()) {
  const { weekday, minutes } = localMinutesOfDay("us", now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= US_FULL_CLOSE_MIN;
}

export function goldenCrossScanEnabled() {
  return String(process.env.STOCK_GOLDEN_CROSS_SCAN ?? "1").trim() !== "0";
}

export function stockVaultIntradayRescanEnabled() {
  return (
    goldenCrossScanEnabled() &&
    String(process.env.STOCK_VAULT_INTRADAY_RESCAN ?? "1").trim() !== "0"
  );
}

let manualScanRunning = false;
let vaultScanRunning = false;
/** @type {Record<"kr"|"us", number>} */
const lastIntradayRescanAtMs = { kr: 0, us: 0 };
/** @type {{ atMs: number; goldenCross: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>; maAlign: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>; ma120Near: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function isGoldenCrossManualScanRunning() {
  return manualScanRunning;
}

export function isVaultMarketScanRunning() {
  return vaultScanRunning || manualScanRunning;
}

export function getLastGoldenCrossManualScanResult() {
  return lastManualScanResult;
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @returns {{ market: "kr"|"us"; scanDate: string; scanned: number; hits: never[]; hitCount: number }}
 */
function emptyGoldenCrossMarketResult(market, scanDate) {
  return { market, scanDate, scanned: 0, hits: [], hitCount: 0 };
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @returns {{ market: "kr"|"us"; scanDate: string; scanned: number; hits: never[]; hitCount: number }}
 */
function emptyMaAlignMarketResult(market, scanDate) {
  return { market, scanDate, scanned: 0, hits: [], hitCount: 0 };
}

function emptyMa120NearMarketResult(market, scanDate) {
  return { market, scanDate, scanned: 0, hits: [], hitCount: 0 };
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {string} runId
 * @param {"manual"|"scheduled"|"intraday"} trigger
 * @param {{ notifyGoldenCrossTelegram?: boolean; persistScanState?: boolean; appendHistory?: boolean; timeframe?: import("./vault-scan-timeframe.js").VaultScanTimeframe }} [opts]
 */
async function runVaultMarketScansForTimeframe(
  market,
  scanDate,
  runId,
  trigger,
  timeframe,
  opts = {},
) {
  const notifyGoldenCrossTelegram = opts.notifyGoldenCrossTelegram !== false;
  const persistScanState = opts.persistScanState !== false;
  const appendHistory = opts.appendHistory !== false;
  const scanOpts = { persistState: persistScanState, timeframe };

  /** @type {PromiseSettledResult<Awaited<ReturnType<typeof runGoldenCrossMarketScan>>>[]} */
  const settled = await Promise.allSettled([
    runGoldenCrossMarketScan(market, scanDate, scanOpts),
    runMaAlignMarketScan(market, scanDate, scanOpts),
    ...(timeframe === "1d"
      ? [runMa120NearMarketScan(market, scanDate, { persistState: persistScanState })]
      : []),
  ]);
  const gcSettled = settled[0];
  const maSettled = settled[1];
  const ma120Settled = timeframe === "1d" ? settled[2] : null;

  /** @type {Awaited<ReturnType<typeof runGoldenCrossMarketScan>>} */
  let goldenCross = emptyGoldenCrossMarketResult(market, scanDate);
  if (gcSettled.status === "fulfilled") {
    goldenCross = gcSettled.value;
    clearGoldenCrossVaultItemsSync({ market, timeframe });
    if (goldenCross.hits.length) {
      mergeGoldenCrossHitsIntoVaultSync(goldenCross.hits);
    }
    if (appendHistory) {
      appendGoldenCrossHistoryEntrySync({
        runId,
        trigger: trigger === "intraday" ? "scheduled" : trigger,
        market,
        scanDate,
        timeframe,
        scanned: goldenCross.scanned,
        hits: goldenCross.hits,
      });
    }
    if (notifyGoldenCrossTelegram) {
      try {
        await notifyGoldenCrossScanTelegram(
          market,
          scanDate,
          goldenCross.hits,
          timeframe,
        );
      } catch (e) {
        liveTradeLogWarn(
          "[stock-vault:scan:golden-cross:telegram]",
          market,
          timeframe,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } else {
    liveTradeLogWarn(
      "[stock-vault:scan:golden-cross]",
      market,
      timeframe,
      gcSettled.reason instanceof Error
        ? gcSettled.reason.message
        : gcSettled.reason,
    );
  }

  /** @type {Awaited<ReturnType<typeof runMaAlignMarketScan>>} */
  let maAlign = emptyMaAlignMarketResult(market, scanDate);
  if (maSettled.status === "fulfilled") {
    maAlign = maSettled.value;
    clearMaAlignVaultItemsSync({ market, timeframe });
    if (maAlign.hits.length) {
      mergeMaAlignHitsIntoVaultSync(maAlign.hits);
    }
    if (appendHistory) {
      appendMaAlignHistoryEntrySync({
        runId,
        trigger: trigger === "intraday" ? "scheduled" : trigger,
        market,
        scanDate,
        timeframe,
        scanned: maAlign.scanned,
        hits: maAlign.hits,
      });
    }
  } else {
    liveTradeLogWarn(
      "[stock-vault:scan:ma-align]",
      market,
      timeframe,
      maSettled.reason instanceof Error
        ? maSettled.reason.message
        : maSettled.reason,
    );
  }

  /** @type {Awaited<ReturnType<typeof runMa120NearMarketScan>>} */
  let ma120Near = emptyMa120NearMarketResult(market, scanDate);
  if (timeframe === "1d" && ma120Settled) {
    if (ma120Settled.status === "fulfilled") {
      ma120Near = ma120Settled.value;
      clearMa120NearVaultItemsSync({ market });
      if (ma120Near.hits.length) {
        mergeMa120NearHitsIntoVaultSync(ma120Near.hits);
      }
      if (appendHistory) {
        appendMa120NearHistoryEntrySync({
          runId,
          trigger: trigger === "intraday" ? "scheduled" : trigger,
          market,
          scanDate,
          scanned: ma120Near.scanned,
          hits: ma120Near.hits,
        });
      }
    } else {
      liveTradeLogWarn(
        "[stock-vault:scan:ma120-near]",
        market,
        ma120Settled.reason instanceof Error
          ? ma120Settled.reason.message
          : ma120Settled.reason,
      );
    }
  }

  liveTradeLogInfo("[stock-vault:scan] timeframe done", {
    market,
    scanDate,
    trigger,
    timeframe,
    goldenCrossHits: goldenCross.hitCount,
    maAlignHits: maAlign.hitCount,
    ma120NearHits: ma120Near.hitCount,
    goldenCrossOk: gcSettled.status === "fulfilled",
    maAlignOk: maSettled.status === "fulfilled",
    ma120NearOk: ma120Settled?.status === "fulfilled",
  });

  return { goldenCross, maAlign, ma120Near, timeframe };
}

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {string} runId
 * @param {"manual"|"scheduled"|"intraday"} trigger
 * @param {{ notifyGoldenCrossTelegram?: boolean; persistScanState?: boolean; appendHistory?: boolean }} [opts]
 */
export async function runVaultMarketScans(
  market,
  scanDate,
  runId,
  trigger,
  opts = {},
) {
  /** @type {Record<import("./vault-scan-timeframe.js").VaultScanTimeframe, { goldenCross: Awaited<ReturnType<typeof runGoldenCrossMarketScan>>; maAlign: Awaited<ReturnType<typeof runMaAlignMarketScan>>; ma120Near: Awaited<ReturnType<typeof runMa120NearMarketScan>> }>} */
  const byTimeframe = {};
  for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
    byTimeframe[timeframe] = await runVaultMarketScansForTimeframe(
      market,
      scanDate,
      runId,
      trigger,
      timeframe,
      opts,
    );
  }

  if (opts.notifyGoldenCrossTelegram !== false) {
    try {
      const intersection = buildMarketTimeframeIntersections(market, scanDate, {
        "1d": {
          goldenCross: byTimeframe["1d"]?.goldenCross ?? { hits: [] },
          maAlign: byTimeframe["1d"]?.maAlign ?? { hits: [] },
        },
        "1wk": {
          goldenCross: byTimeframe["1wk"]?.goldenCross ?? { hits: [] },
          maAlign: byTimeframe["1wk"]?.maAlign ?? { hits: [] },
        },
      });
      await notifyVaultTimeframeIntersectionTelegram(intersection);
    } catch (e) {
      liveTradeLogWarn(
        "[stock-vault:scan:intersection:telegram]",
        market,
        e instanceof Error ? e.message : e,
      );
    }
  }

  try {
    const { scheduleStockVaultIndustryFinancialsRefresh } = await import(
      "./stock-vault-industry-financials.js"
    );
    scheduleStockVaultIndustryFinancialsRefresh();
  } catch {
    /* ignore industry financials refresh scheduling */
  }

  const daily = byTimeframe["1d"];
  return {
    goldenCross: daily.goldenCross,
    maAlign: daily.maAlign,
    ma120Near: daily.ma120Near,
    byTimeframe,
  };
}

/**
 * @param {"kr"|"us"} market
 * @param {number} [lastAtMs]
 * @param {Date} [now]
 */
export function shouldRunVaultIntradayRescan(
  market,
  lastAtMs = lastIntradayRescanAtMs[market],
  now = new Date(),
) {
  if (!stockVaultIntradayRescanEnabled()) return false;
  if (!isStockTradableBySchedule(market, now)) return false;
  if (Date.now() - lastAtMs < INTRADAY_RESCAN_MS) return false;
  return true;
}

/** @param {"kr"|"us"} market @param {Date} [now] */
export async function runVaultIntradayRescanIfDue(market, now = new Date()) {
  if (!shouldRunVaultIntradayRescan(market, lastIntradayRescanAtMs[market], now)) {
    return null;
  }
  if (vaultScanRunning || manualScanRunning) return null;

  const scanDate =
    market === "kr"
      ? getKstParts(now).dateKey
      : localMinutesOfDay("us", now).dateKey;
  vaultScanRunning = true;
  try {
    const result = await runMaAlignVaultIntradayRefresh(market, scanDate);
    lastIntradayRescanAtMs[market] = Date.now();
    liveTradeLogInfo("[stock-vault:intraday] ma_align refresh done", result);
    return result;
  } finally {
    vaultScanRunning = false;
  }
}

/** @param {Date} [now] */
async function runGoldenCrossManualScanInternal(now = new Date()) {
  const runId = randomUUID();

  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const goldenCrossResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const maAlignResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const ma120NearResults = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").GoldenCrossEmailMarket[]} */
  const goldenCrossEmailMarkets = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").MaAlignEmailMarket[]} */
  const maAlignEmailMarkets = [];

  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr"
        ? getKstParts(now).dateKey
        : localMinutesOfDay("us", now).dateKey;
    let goldenCross = emptyGoldenCrossMarketResult(market, scanDate);
    let maAlign = emptyMaAlignMarketResult(market, scanDate);
    let ma120Near = emptyMa120NearMarketResult(market, scanDate);
    let byTimeframe = null;
    try {
      const scanResult = await runVaultMarketScans(
        market,
        scanDate,
        runId,
        "manual",
      );
      goldenCross = scanResult.goldenCross;
      maAlign = scanResult.maAlign;
      ma120Near = scanResult.ma120Near;
      byTimeframe = scanResult.byTimeframe;
    } catch (e) {
      liveTradeLogWarn(
        "[golden-cross:manual]",
        market,
        e instanceof Error ? e.message : e,
      );
    }
    if (byTimeframe) {
      const payload = buildScanEmailPayloadFromVaultResult(
        market,
        scanDate,
        byTimeframe,
      );
      goldenCrossEmailMarkets.push(...payload.goldenCross);
      maAlignEmailMarkets.push(...payload.maAlign);
    } else {
      goldenCrossEmailMarkets.push({
        market,
        scanDate,
        timeframe: "1d",
        scanned: goldenCross.scanned,
        hits: goldenCross.hits,
      });
      maAlignEmailMarkets.push({
        market,
        scanDate,
        timeframe: "1d",
        scanned: maAlign.scanned,
        hits: maAlign.hits,
      });
    }
    goldenCrossResults.push({
      market,
      scanDate,
      scanned: goldenCross.scanned,
      hitCount: goldenCross.hitCount,
    });
    maAlignResults.push({
      market,
      scanDate,
      scanned: maAlign.scanned,
      hitCount: maAlign.hitCount,
    });
    ma120NearResults.push({
      market,
      scanDate,
      scanned: ma120Near.scanned,
      hitCount: ma120Near.hitCount,
    });
  }

  try {
    const emailResult = await sendGoldenCrossScanReportEmail({
      goldenCross: goldenCrossEmailMarkets,
      maAlign: maAlignEmailMarkets,
    });
    liveTradeLogInfo("[stock-vault:scan:email]", {
      sent: emailResult.sent,
      goldenCrossHits: emailResult.goldenCrossHits,
      maAlignHits: emailResult.maAlignHits,
      recipients: emailResult.recipients,
    });
  } catch (e) {
    liveTradeLogWarn(
      "[stock-vault:scan:email]",
      e instanceof Error ? e.message : e,
    );
  }

  lastManualScanResult = {
    atMs: Date.now(),
    goldenCross: goldenCrossResults,
    maAlign: maAlignResults,
    ma120Near: ma120NearResults,
  };
  return lastManualScanResult;
}

/** @returns {{ started: boolean; reason?: string }} */
export function triggerGoldenCrossManualScan() {
  if (!goldenCrossScanEnabled()) {
    return { started: false, reason: "disabled" };
  }
  if (manualScanRunning) {
    return { started: false, reason: "busy" };
  }
  manualScanRunning = true;
  vaultScanRunning = true;
  void runGoldenCrossManualScanInternal()
    .catch((e) => {
      liveTradeLogWarn(
        "[golden-cross:manual]",
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      manualScanRunning = false;
      vaultScanRunning = false;
    });
  return { started: true };
}

/** @param {Date} [now] */
export function shouldRunGoldenCrossScan(market, now = new Date()) {
  if (!goldenCrossScanEnabled()) return false;
  const local =
    market === "kr" ? getKstParts(now) : localMinutesOfDay("us", now);
  const dateKey = local.dateKey;
  for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
    if (
      !wasGoldenCrossScannedSync(market, dateKey, timeframe) ||
      !wasMaAlignScannedSync(market, dateKey, timeframe) ||
      (timeframe === "1d" && !wasMa120NearScannedSync(market, dateKey))
    ) {
      return market === "kr"
        ? isKrMarketFullyClosed(now)
        : isUsMarketFullyClosed(now);
    }
  }
  return false;
}

/** @param {"kr"|"us"} market @param {Date} [now] */
export async function runGoldenCrossScanIfDue(market, now = new Date()) {
  if (!shouldRunGoldenCrossScan(market, now)) return null;
  const scanDate =
    market === "kr"
      ? getKstParts(now).dateKey
      : localMinutesOfDay("us", now).dateKey;

  const runId = randomUUID();
  vaultScanRunning = true;
  try {
    const { goldenCross, maAlign, ma120Near, byTimeframe } = await runVaultMarketScans(
      market,
      scanDate,
      runId,
      "scheduled",
    );
    try {
      const payload = buildScanEmailPayloadFromVaultResult(
        market,
        scanDate,
        byTimeframe,
      );
      await sendGoldenCrossScanReportEmail(payload);
    } catch (e) {
      liveTradeLogWarn(
        "[stock-vault:scan:email]",
        market,
        e instanceof Error ? e.message : e,
      );
    }
    return { goldenCross, maAlign, ma120Near: byTimeframe["1d"]?.ma120Near };
  } finally {
    vaultScanRunning = false;
  }
}

export function startGoldenCrossScanPoller() {
  if (!goldenCrossScanEnabled()) return;
  const g = /** @type {typeof globalThis & { __stockGoldenCrossScan?: boolean }} */ (
    globalThis
  );
  if (g.__stockGoldenCrossScan) return;
  g.__stockGoldenCrossScan = true;

  let running = false;
  const tick = () => {
    if (running || manualScanRunning) return;
    running = true;
    void pollerGuardAsync("golden-cross", async () => {
      for (const market of /** @type {const} */ (["kr", "us"])) {
        try {
          const result = await runGoldenCrossScanIfDue(market);
          if (result) {
            liveTradeLogInfo("[golden-cross:poller] ran", {
              market,
              goldenCrossHits: result.goldenCross.hitCount,
              maAlignHits: result.maAlign.hitCount,
              ma120NearHits: result.ma120Near?.hitCount ?? 0,
            });
          }
        } catch (e) {
          liveTradeLogWarn(
            "[golden-cross:poller]",
            market,
            e instanceof Error ? e.message : e,
          );
        }
      }
    })
      .catch((e) => {
        liveTradeLogWarn(
          "[golden-cross:poller]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        running = false;
      });
  };

  let intradayRunning = false;
  const intradayTick = () => {
    if (!stockVaultIntradayRescanEnabled()) return;
    if (intradayRunning || vaultScanRunning || manualScanRunning) return;
    intradayRunning = true;
    void pollerGuardAsync("golden-cross-intraday", async () => {
      for (const market of /** @type {const} */ (["kr", "us"])) {
        try {
          await runVaultIntradayRescanIfDue(market);
        } catch (e) {
          liveTradeLogWarn(
            "[stock-vault:intraday]",
            market,
            e instanceof Error ? e.message : e,
          );
        }
      }
    })
      .catch((e) => {
        liveTradeLogWarn(
          "[stock-vault:intraday]",
          e instanceof Error ? e.message : e,
        );
      })
      .finally(() => {
        intradayRunning = false;
      });
  };

  tick();
  markPollerBootStarted("golden-cross");
  markPollerBootStarted("golden-cross-intraday");
  setInterval(tick, POLL_MS);
  intradayTick();
  setInterval(intradayTick, INTRADAY_TICK_MS);
}
