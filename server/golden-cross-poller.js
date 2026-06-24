import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { runGoldenCrossMarketScan, wasGoldenCrossScannedSync } from "./golden-cross-scan.js";
import { runMaAlignMarketScan, wasMaAlignScannedSync } from "./ma-align-scan.js";
import { runMa120NearMarketScan, wasMa120NearScannedSync } from "./ma120-near-scan.js";
import {
  runCandleLowSlopeMarketScan,
  wasCandleLowSlopeScannedSync,
} from "./candle-low-slope-scan.js";
import {
  runBookAccumulationMarketScan,
  wasBookAccumulationScannedSync,
} from "./book-accumulation-scan.js";
import {
  clearGoldenCrossVaultItemsSync,
  clearMaAlignVaultItemsSync,
  clearMa120NearVaultItemsSync,
  clearLowSlopeFlipVaultItemsSync,
  clearBookAccumVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  mergeMaAlignHitsIntoVaultSync,
  mergeMa120NearHitsIntoVaultSync,
  mergeLowSlopeFlipHitsIntoVaultSync,
  mergeBookAccumHitsIntoVaultSync,
} from "./stock-vault-store.js";
import {
  assessScanVaultMerge,
  applyVaultScanMerge,
} from "./scan-vault-merge.js";
import { appendGoldenCrossHistoryEntrySync } from "./golden-cross-history-store.js";
import { appendMaAlignHistoryEntrySync } from "./ma-align-history-store.js";
import { appendMa120NearHistoryEntrySync } from "./ma120-near-history-store.js";
import {
  notifyGoldenCrossScanTelegram,
  notifyVaultScanDoneTelegram,
  notifyVaultScanStartTelegram,
  notifyVaultTimeframeIntersectionTelegram,
} from "./golden-cross-telegram.js";
import { sendGoldenCrossScanReportEmail, buildScanEmailPayloadFromVaultResult } from "./notifications/golden-cross-scan-email.js";
import { runMaAlignVaultIntradayRefresh } from "./ma-align-vault-intraday.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";
import { markPollerBootStarted, pollerGuardAsync } from "./poller-registry.js";
import { isStockTradableBySchedule } from "./market-hours.js";
import { VAULT_SCAN_TIMEFRAMES } from "./vault-scan-timeframe.js";
import { buildMarketTimeframeIntersections } from "./vault-scan-intersection.js";
import {
  beginVaultScanProgressSession,
  endVaultScanProgressSession,
  vaultScanProgressReporter,
} from "./vault-scan-progress.js";

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

function emptyBookAccumMarketResult(market, scanDate) {
  return { market, scanDate, scanned: 0, hits: [], hitCount: 0 };
}

function emptyLowSlopeMarketResult(market, scanDate) {
  return { market, scanDate, scanned: 0, hits: [], hitCount: 0 };
}

/** @param {() => Promise<unknown>} run */
async function timeMarketScan(run) {
  const t0 = performance.now();
  try {
    return { ok: true, result: await run(), durationMs: performance.now() - t0 };
  } catch (error) {
    return { ok: false, error, durationMs: performance.now() - t0 };
  }
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
  const progress = (kind) =>
    vaultScanProgressReporter(kind, market, timeframe);

  const timedResults =
    timeframe === "1d"
      ? await Promise.all([
          timeMarketScan(() =>
            runGoldenCrossMarketScan(market, scanDate, {
              ...scanOpts,
              onProgress: progress("golden_cross"),
            }),
          ),
          timeMarketScan(() =>
            runMaAlignMarketScan(market, scanDate, {
              ...scanOpts,
              onProgress: progress("ma_align"),
            }),
          ),
          timeMarketScan(() =>
            runMa120NearMarketScan(market, scanDate, {
              persistState: persistScanState,
              onProgress: progress("ma120_near"),
            }),
          ),
          timeMarketScan(() =>
            runBookAccumulationMarketScan(market, scanDate, {
              persistState: persistScanState,
              timeframe,
              onProgress: progress("book_accum"),
            }),
          ),
        ])
      : await Promise.all([
          timeMarketScan(() =>
            runGoldenCrossMarketScan(market, scanDate, {
              ...scanOpts,
              onProgress: progress("golden_cross"),
            }),
          ),
          timeMarketScan(() =>
            runMaAlignMarketScan(market, scanDate, {
              ...scanOpts,
              onProgress: progress("ma_align"),
            }),
          ),
          timeMarketScan(() =>
            runCandleLowSlopeMarketScan(market, scanDate, {
              persistState: persistScanState,
              onProgress: progress("low_slope_flip"),
            }),
          ),
          timeMarketScan(() =>
            runBookAccumulationMarketScan(market, scanDate, {
              persistState: persistScanState,
              timeframe,
              onProgress: progress("book_accum"),
            }),
          ),
        ]);

  const gcTimed = timedResults[0];
  const maTimed = timedResults[1];
  const ma120Timed = timeframe === "1d" ? timedResults[2] : null;
  const lowSlopeTimed = timeframe === "1wk" ? timedResults[2] : null;
  const bookTimed = timedResults[3];

  /** @type {ReturnType<typeof assessScanVaultMerge> | undefined} */
  let gcMerge;
  /** @type {ReturnType<typeof assessScanVaultMerge> | undefined} */
  let maMerge;
  /** @type {ReturnType<typeof assessScanVaultMerge> | undefined} */
  let ma120Merge;
  /** @type {ReturnType<typeof assessScanVaultMerge> | undefined} */
  let lowSlopeMerge;
  /** @type {ReturnType<typeof assessScanVaultMerge> | undefined} */
  let bookMerge;

  /** @type {Awaited<ReturnType<typeof runGoldenCrossMarketScan>>} */
  let goldenCross = emptyGoldenCrossMarketResult(market, scanDate);
  if (gcTimed.ok) {
    goldenCross = /** @type {Awaited<ReturnType<typeof runGoldenCrossMarketScan>>} */ (
      gcTimed.result
    );
    gcMerge = applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: goldenCross.scanned,
        hitCount: goldenCross.hitCount,
        errors: goldenCross.errors ?? 0,
      }),
      {
        clear: () => clearGoldenCrossVaultItemsSync({ market, timeframe }),
        merge: (hits) => mergeGoldenCrossHitsIntoVaultSync(/** @type {typeof goldenCross.hits} */ (hits)),
      },
      goldenCross.hits,
    );
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
      gcTimed.error instanceof Error ? gcTimed.error.message : gcTimed.error,
    );
  }

  /** @type {Awaited<ReturnType<typeof runMaAlignMarketScan>>} */
  let maAlign = emptyMaAlignMarketResult(market, scanDate);
  if (maTimed.ok) {
    maAlign = /** @type {Awaited<ReturnType<typeof runMaAlignMarketScan>>} */ (
      maTimed.result
    );
    maMerge = applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: maAlign.scanned,
        hitCount: maAlign.hitCount,
      }),
      {
        clear: () => clearMaAlignVaultItemsSync({ market, timeframe }),
        merge: (hits) => mergeMaAlignHitsIntoVaultSync(/** @type {typeof maAlign.hits} */ (hits)),
      },
      maAlign.hits,
    );
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
      maTimed.error instanceof Error ? maTimed.error.message : maTimed.error,
    );
  }

  /** @type {Awaited<ReturnType<typeof runMa120NearMarketScan>>} */
  let ma120Near = emptyMa120NearMarketResult(market, scanDate);
  if (timeframe === "1d" && ma120Timed) {
    if (ma120Timed.ok) {
      ma120Near = /** @type {Awaited<ReturnType<typeof runMa120NearMarketScan>>} */ (
        ma120Timed.result
      );
      ma120Merge = applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: ma120Near.scanned,
          hitCount: ma120Near.hitCount,
        }),
        {
          clear: () => clearMa120NearVaultItemsSync({ market }),
          merge: (hits) =>
            mergeMa120NearHitsIntoVaultSync(/** @type {typeof ma120Near.hits} */ (hits)),
        },
        ma120Near.hits,
      );
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
        ma120Timed.error instanceof Error
          ? ma120Timed.error.message
          : ma120Timed.error,
      );
    }
  }

  /** @type {Awaited<ReturnType<typeof runCandleLowSlopeMarketScan>>} */
  let lowSlope = emptyLowSlopeMarketResult(market, scanDate);
  if (timeframe === "1wk" && lowSlopeTimed) {
    if (lowSlopeTimed.ok) {
      lowSlope = /** @type {Awaited<ReturnType<typeof runCandleLowSlopeMarketScan>>} */ (
        lowSlopeTimed.result
      );
      lowSlopeMerge = applyVaultScanMerge(
        assessScanVaultMerge({
          scanned: lowSlope.scanned,
          hitCount: lowSlope.hitCount,
        }),
        {
          clear: () => clearLowSlopeFlipVaultItemsSync({ market }),
          merge: (hits) =>
            mergeLowSlopeFlipHitsIntoVaultSync(/** @type {typeof lowSlope.hits} */ (hits)),
        },
        lowSlope.hits,
      );
    } else {
      liveTradeLogWarn(
        "[stock-vault:scan:low-slope]",
        market,
        lowSlopeTimed.error instanceof Error
          ? lowSlopeTimed.error.message
          : lowSlopeTimed.error,
      );
    }
  }

  /** @type {Awaited<ReturnType<typeof runBookAccumulationMarketScan>>} */
  let bookAccum = emptyBookAccumMarketResult(market, scanDate);
  if (bookTimed.ok) {
    bookAccum = /** @type {Awaited<ReturnType<typeof runBookAccumulationMarketScan>>} */ (
      bookTimed.result
    );
    bookMerge = applyVaultScanMerge(
      assessScanVaultMerge({
        scanned: bookAccum.scanned,
        hitCount: bookAccum.hitCount,
        errors: bookAccum.errors ?? 0,
      }),
      {
        clear: () => clearBookAccumVaultItemsSync({ market, timeframe }),
        merge: (hits) =>
          mergeBookAccumHitsIntoVaultSync(/** @type {typeof bookAccum.hits} */ (hits)),
      },
      bookAccum.hits,
    );
  } else {
    liveTradeLogWarn(
      "[stock-vault:scan:book-accum]",
      market,
      bookTimed.error instanceof Error ? bookTimed.error.message : bookTimed.error,
    );
  }

  /** @type {import("./golden-cross-telegram.js").VaultScanTimingRow[]} */
  const timings = [
    {
      market,
      timeframe,
      kind: "goldenCross",
      durationMs: gcTimed.durationMs,
      hitCount: goldenCross.hitCount,
      ok: gcTimed.ok,
    },
    {
      market,
      timeframe,
      kind: "maAlign",
      durationMs: maTimed.durationMs,
      hitCount: maAlign.hitCount,
      ok: maTimed.ok,
    },
    ...(timeframe === "1d" && ma120Timed
      ? [
          {
            market,
            timeframe,
            kind: "ma120Near",
            durationMs: ma120Timed.durationMs,
            hitCount: ma120Near.hitCount,
            ok: ma120Timed.ok,
          },
        ]
      : []),
    ...(timeframe === "1wk" && lowSlopeTimed
      ? [
          {
            market,
            timeframe,
            kind: "lowSlopeFlip",
            durationMs: lowSlopeTimed.durationMs,
            hitCount: lowSlope.hitCount,
            ok: lowSlopeTimed.ok,
          },
        ]
      : []),
    {
      market,
      timeframe,
      kind: "bookAccum",
      durationMs: bookTimed.durationMs,
      hitCount: bookAccum.hitCount,
      ok: bookTimed.ok,
    },
  ];

  liveTradeLogInfo("[stock-vault:scan] timeframe done", {
    market,
    scanDate,
    trigger,
    timeframe,
    goldenCrossHits: goldenCross.hitCount,
    maAlignHits: maAlign.hitCount,
    ma120NearHits: ma120Near.hitCount,
    lowSlopeHits: lowSlope.hitCount,
    bookAccumHits: bookAccum.hitCount,
    goldenCrossOk: gcTimed.ok,
    maAlignOk: maTimed.ok,
    ma120NearOk: ma120Timed?.ok,
    lowSlopeOk: lowSlopeTimed?.ok,
    bookAccumOk: bookTimed.ok,
    vaultMerge: {
      goldenCross: gcMerge?.outcome,
      maAlign: maMerge?.outcome,
      ma120Near: ma120Merge?.outcome,
      lowSlopeFlip: lowSlopeMerge?.outcome,
      bookAccum: bookMerge?.outcome,
    },
  });

  return { goldenCross, maAlign, ma120Near, lowSlope, bookAccum, timeframe, timings };
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
  /** @type {import("./golden-cross-telegram.js").VaultScanTimingRow[]} */
  const timings = [];
  for (const timeframe of VAULT_SCAN_TIMEFRAMES) {
    const tfResult = await runVaultMarketScansForTimeframe(
      market,
      scanDate,
      runId,
      trigger,
      timeframe,
      opts,
    );
    byTimeframe[timeframe] = tfResult;
    timings.push(...tfResult.timings);
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
  const weekly = byTimeframe["1wk"];
  return {
    goldenCross: daily.goldenCross,
    maAlign: daily.maAlign,
    ma120Near: daily.ma120Near,
    lowSlope: weekly.lowSlope,
    bookAccum: daily.bookAccum,
    byTimeframe,
    timings,
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
  const kstDate = getKstParts(now).dateKey;
  const startedAt = performance.now();
  await notifyVaultScanStartTelegram({
    trigger: "manual",
    market: "all",
    scanDate: kstDate,
  }).catch(() => {});

  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const goldenCrossResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const maAlignResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const ma120NearResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const bookAccumResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const lowSlopeResults = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").GoldenCrossEmailMarket[]} */
  const goldenCrossEmailMarkets = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").MaAlignEmailMarket[]} */
  const maAlignEmailMarkets = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").Ma120NearEmailMarket[]} */
  const ma120NearEmailMarkets = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").BookAccumEmailMarket[]} */
  const bookAccumEmailMarkets = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").LowSlopeFlipEmailMarket[]} */
  const lowSlopeEmailMarkets = [];
  /** @type {import("./golden-cross-telegram.js").VaultScanTimingRow[]} */
  const allTimings = [];

  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr"
        ? getKstParts(now).dateKey
        : localMinutesOfDay("us", now).dateKey;
    let goldenCross = emptyGoldenCrossMarketResult(market, scanDate);
    let maAlign = emptyMaAlignMarketResult(market, scanDate);
    let ma120Near = emptyMa120NearMarketResult(market, scanDate);
    let bookAccum = emptyBookAccumMarketResult(market, scanDate);
    let lowSlope = emptyLowSlopeMarketResult(market, scanDate);
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
      bookAccum = scanResult.bookAccum ?? emptyBookAccumMarketResult(market, scanDate);
      lowSlope = scanResult.lowSlope ?? emptyLowSlopeMarketResult(market, scanDate);
      byTimeframe = scanResult.byTimeframe;
      if (scanResult.timings?.length) allTimings.push(...scanResult.timings);
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
      ma120NearEmailMarkets.push(...payload.ma120Near);
      bookAccumEmailMarkets.push(...payload.bookAccum);
      lowSlopeEmailMarkets.push(...payload.lowSlopeFlip);
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
    bookAccumResults.push({
      market,
      scanDate,
      scanned: bookAccum.scanned,
      hitCount: bookAccum.hitCount,
    });
    lowSlopeResults.push({
      market,
      scanDate,
      scanned: lowSlope.scanned,
      hitCount: lowSlope.hitCount,
    });
  }

  try {
    const emailResult = await sendGoldenCrossScanReportEmail({
      goldenCross: goldenCrossEmailMarkets,
      maAlign: maAlignEmailMarkets,
      ma120Near: ma120NearEmailMarkets,
      bookAccum: bookAccumEmailMarkets,
      lowSlopeFlip: lowSlopeEmailMarkets,
    });
    liveTradeLogInfo("[stock-vault:scan:email]", {
      sent: emailResult.sent,
      goldenCrossHits: emailResult.goldenCrossHits,
      maAlignHits: emailResult.maAlignHits,
      ma120NearHits: emailResult.ma120NearHits,
      bookAccumHits: emailResult.bookAccumHits,
      lowSlopeFlipHits: emailResult.lowSlopeFlipHits,
      recipients: emailResult.recipients,
    });
  } catch (e) {
    liveTradeLogWarn(
      "[stock-vault:scan:email]",
      e instanceof Error ? e.message : e,
    );
  }

  await notifyVaultScanDoneTelegram({
    trigger: "manual",
    market: "all",
    scanDate: kstDate,
    totalDurationMs: performance.now() - startedAt,
    rows: allTimings,
  }).catch(() => {});

  lastManualScanResult = {
    atMs: Date.now(),
    goldenCross: goldenCrossResults,
    maAlign: maAlignResults,
    ma120Near: ma120NearResults,
    bookAccum: bookAccumResults,
    lowSlope: lowSlopeResults,
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
  beginVaultScanProgressSession(runId);
  void runGoldenCrossManualScanInternal()
    .catch((e) => {
      liveTradeLogWarn(
        "[golden-cross:manual]",
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      endVaultScanProgressSession();
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
      (timeframe === "1d" && !wasMa120NearScannedSync(market, dateKey)) ||
      (timeframe === "1wk" && !wasCandleLowSlopeScannedSync(market, dateKey)) ||
      !wasBookAccumulationScannedSync(market, dateKey, timeframe)
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
  const startedAt = performance.now();
  await notifyVaultScanStartTelegram({
    trigger: "scheduled",
    market,
    scanDate,
  }).catch(() => {});
  vaultScanRunning = true;
  /** @type {import("./golden-cross-telegram.js").VaultScanTimingRow[]} */
  let scanTimings = [];
  beginVaultScanProgressSession(runId);
  try {
    const scanResult = await runVaultMarketScans(
      market,
      scanDate,
      runId,
      "scheduled",
    );
    scanTimings = scanResult.timings ?? [];
    const { goldenCross, maAlign, byTimeframe } = scanResult;
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
    await notifyVaultScanDoneTelegram({
      trigger: "scheduled",
      market,
      scanDate,
      totalDurationMs: performance.now() - startedAt,
      rows: scanTimings,
    }).catch(() => {});
    return { goldenCross, maAlign, ma120Near: byTimeframe["1d"]?.ma120Near };
  } finally {
    endVaultScanProgressSession();
    vaultScanRunning = false;
  }
}

const GC_WORKER_URL = new URL("./golden-cross-scan-worker.js", import.meta.url);

/** 골든크로스 스캔을 별도 Worker Thread에서 실행해 GC 중단이 API 응답을 막지 않도록 함 */
function spawnGoldenCrossScanWorker(market) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(GC_WORKER_URL, { workerData: { market } });
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error));
    });
    worker.once("error", (err) => reject(err));
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`[golden-cross:poller] worker exit ${code}`));
    });
  });
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
        if (!shouldRunGoldenCrossScan(market)) continue;
        vaultScanRunning = true;
        try {
          const result = await spawnGoldenCrossScanWorker(market);
          if (result) {
            liveTradeLogInfo("[golden-cross:poller] worker ran", {
              market,
              goldenCrossHits: result.goldenCross?.hitCount ?? 0,
              maAlignHits: result.maAlign?.hitCount ?? 0,
              ma120NearHits: result.ma120Near?.hitCount ?? 0,
            });
          }
        } catch (e) {
          liveTradeLogWarn(
            "[golden-cross:poller]",
            market,
            e instanceof Error ? e.message : e,
          );
        } finally {
          vaultScanRunning = false;
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
