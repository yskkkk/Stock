import { randomUUID } from "node:crypto";
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { runGoldenCrossMarketScan, wasGoldenCrossScannedSync } from "./golden-cross-scan.js";
import { runMaAlignMarketScan, wasMaAlignScannedSync } from "./ma-align-scan.js";
import {
  clearGoldenCrossVaultItemsSync,
  clearMaAlignVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  mergeMaAlignHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { appendGoldenCrossHistoryEntrySync } from "./golden-cross-history-store.js";
import { appendMaAlignHistoryEntrySync } from "./ma-align-history-store.js";
import { notifyGoldenCrossScanTelegram } from "./golden-cross-telegram.js";
import { sendGoldenCrossScanReportEmail } from "./notifications/golden-cross-scan-email.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const POLL_MS = (() => {
  const n = Number(process.env.STOCK_GOLDEN_CROSS_POLL_MS ?? 300_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 900_000) : 300_000;
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

let manualScanRunning = false;
/** @type {{ atMs: number; goldenCross: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>; maAlign: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function isGoldenCrossManualScanRunning() {
  return manualScanRunning;
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

/**
 * @param {"kr"|"us"} market
 * @param {string} scanDate
 * @param {string} runId
 * @param {"manual"|"scheduled"} trigger
 */
export async function runVaultMarketScans(market, scanDate, runId, trigger) {
  clearGoldenCrossVaultItemsSync({ market });
  clearMaAlignVaultItemsSync({ market });

  const [gcSettled, maSettled] = await Promise.allSettled([
    runGoldenCrossMarketScan(market, scanDate),
    runMaAlignMarketScan(market, scanDate),
  ]);

  /** @type {Awaited<ReturnType<typeof runGoldenCrossMarketScan>>} */
  let goldenCross = emptyGoldenCrossMarketResult(market, scanDate);
  if (gcSettled.status === "fulfilled") {
    goldenCross = gcSettled.value;
    if (goldenCross.hits.length) {
      mergeGoldenCrossHitsIntoVaultSync(goldenCross.hits);
    }
    appendGoldenCrossHistoryEntrySync({
      runId,
      trigger,
      market,
      scanDate,
      scanned: goldenCross.scanned,
      hits: goldenCross.hits,
    });
    try {
      await notifyGoldenCrossScanTelegram(market, scanDate, goldenCross.hits);
    } catch (e) {
      liveTradeLogWarn(
        "[stock-vault:scan:golden-cross:telegram]",
        market,
        e instanceof Error ? e.message : e,
      );
    }
  } else {
    liveTradeLogWarn(
      "[stock-vault:scan:golden-cross]",
      market,
      gcSettled.reason instanceof Error
        ? gcSettled.reason.message
        : gcSettled.reason,
    );
  }

  /** @type {Awaited<ReturnType<typeof runMaAlignMarketScan>>} */
  let maAlign = emptyMaAlignMarketResult(market, scanDate);
  if (maSettled.status === "fulfilled") {
    maAlign = maSettled.value;
    if (maAlign.hits.length) {
      mergeMaAlignHitsIntoVaultSync(maAlign.hits);
    }
    appendMaAlignHistoryEntrySync({
      runId,
      trigger,
      market,
      scanDate,
      scanned: maAlign.scanned,
      hits: maAlign.hits,
    });
  } else {
    liveTradeLogWarn(
      "[stock-vault:scan:ma-align]",
      market,
      maSettled.reason instanceof Error
        ? maSettled.reason.message
        : maSettled.reason,
    );
  }

  liveTradeLogInfo("[stock-vault:scan] market done", {
    market,
    scanDate,
    trigger,
    goldenCrossHits: goldenCross.hitCount,
    maAlignHits: maAlign.hitCount,
    goldenCrossOk: gcSettled.status === "fulfilled",
    maAlignOk: maSettled.status === "fulfilled",
  });

  return { goldenCross, maAlign };
}

/** @param {Date} [now] */
async function runGoldenCrossManualScanInternal(now = new Date()) {
  const runId = randomUUID();

  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const goldenCrossResults = [];
  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const maAlignResults = [];
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
    try {
      ({ goldenCross, maAlign } = await runVaultMarketScans(
        market,
        scanDate,
        runId,
        "manual",
      ));
    } catch (e) {
      liveTradeLogWarn(
        "[golden-cross:manual]",
        market,
        e instanceof Error ? e.message : e,
      );
    }
    goldenCrossEmailMarkets.push({
      market,
      scanDate,
      scanned: goldenCross.scanned,
      hits: goldenCross.hits,
    });
    maAlignEmailMarkets.push({
      market,
      scanDate,
      scanned: maAlign.scanned,
      hits: maAlign.hits,
    });
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
  void runGoldenCrossManualScanInternal()
    .catch((e) => {
      liveTradeLogWarn(
        "[golden-cross:manual]",
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      manualScanRunning = false;
    });
  return { started: true };
}

/** @param {"kr"|"us"} market @param {Date} [now] */
export function shouldRunGoldenCrossScan(market, now = new Date()) {
  if (!goldenCrossScanEnabled()) return false;
  const local =
    market === "kr" ? getKstParts(now) : localMinutesOfDay("us", now);
  const dateKey = local.dateKey;
  if (
    wasGoldenCrossScannedSync(market, dateKey) &&
    wasMaAlignScannedSync(market, dateKey)
  ) {
    return false;
  }
  return market === "kr" ? isKrMarketFullyClosed(now) : isUsMarketFullyClosed(now);
}

/** @param {"kr"|"us"} market @param {Date} [now] */
export async function runGoldenCrossScanIfDue(market, now = new Date()) {
  if (!shouldRunGoldenCrossScan(market, now)) return null;
  const scanDate =
    market === "kr"
      ? getKstParts(now).dateKey
      : localMinutesOfDay("us", now).dateKey;

  const runId = randomUUID();
  const { goldenCross, maAlign } = await runVaultMarketScans(
    market,
    scanDate,
    runId,
    "scheduled",
  );

  try {
    await sendGoldenCrossScanReportEmail({
      goldenCross: [
        {
          market,
          scanDate,
          scanned: goldenCross.scanned,
          hits: goldenCross.hits,
        },
      ],
      maAlign: [
        {
          market,
          scanDate,
          scanned: maAlign.scanned,
          hits: maAlign.hits,
        },
      ],
    });
  } catch (e) {
    liveTradeLogWarn(
      "[stock-vault:scan:email]",
      market,
      e instanceof Error ? e.message : e,
    );
  }
  return { goldenCross, maAlign };
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
    (async () => {
      for (const market of /** @type {const} */ (["kr", "us"])) {
        try {
          const result = await runGoldenCrossScanIfDue(market);
          if (result) {
            liveTradeLogInfo("[golden-cross:poller] ran", {
              market,
              goldenCrossHits: result.goldenCross.hitCount,
              maAlignHits: result.maAlign.hitCount,
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
    })()
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

  tick();
  setInterval(tick, POLL_MS);
}
