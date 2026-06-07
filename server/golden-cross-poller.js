import { randomUUID } from "node:crypto";
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { runGoldenCrossMarketScan, wasGoldenCrossScannedSync } from "./golden-cross-scan.js";
import {
  clearGoldenCrossVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
} from "./stock-vault-store.js";
import { appendGoldenCrossHistoryEntrySync } from "./golden-cross-history-store.js";
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
/** @type {{ atMs: number; results: Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }> } | null} */
let lastManualScanResult = null;

export function isGoldenCrossManualScanRunning() {
  return manualScanRunning;
}

export function getLastGoldenCrossManualScanResult() {
  return lastManualScanResult;
}

/** @param {Date} [now] */
async function runGoldenCrossManualScanInternal(now = new Date()) {
  const runId = randomUUID();
  clearGoldenCrossVaultItemsSync();

  /** @type {Array<{ market: "kr"|"us"; scanDate: string; scanned: number; hitCount: number }>} */
  const results = [];
  /** @type {import("./notifications/golden-cross-scan-email.js").GoldenCrossEmailMarket[]} */
  const emailMarkets = [];

  for (const market of /** @type {const} */ (["kr", "us"])) {
    const scanDate =
      market === "kr"
        ? getKstParts(now).dateKey
        : localMinutesOfDay("us", now).dateKey;
    const result = await runGoldenCrossMarketScan(market, scanDate);
    if (result.hits.length) {
      mergeGoldenCrossHitsIntoVaultSync(result.hits);
    }
    appendGoldenCrossHistoryEntrySync({
      runId,
      trigger: "manual",
      market,
      scanDate,
      scanned: result.scanned,
      hits: result.hits,
    });
    await notifyGoldenCrossScanTelegram(market, scanDate, result.hits);
    emailMarkets.push({
      market,
      scanDate,
      scanned: result.scanned,
      hits: result.hits,
    });
    results.push({
      market,
      scanDate,
      scanned: result.scanned,
      hitCount: result.hitCount,
    });
  }

  try {
    const emailResult = await sendGoldenCrossScanReportEmail({ markets: emailMarkets });
    liveTradeLogInfo("[golden-cross:email]", {
      sent: emailResult.sent,
      totalHits: emailResult.totalHits,
      recipients: emailResult.recipients,
    });
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:email]",
      e instanceof Error ? e.message : e,
    );
  }

  lastManualScanResult = { atMs: Date.now(), results };
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
  const dateKey = market === "kr" ? local.dateKey : local.dateKey;
  if (wasGoldenCrossScannedSync(market, dateKey)) return false;
  return market === "kr" ? isKrMarketFullyClosed(now) : isUsMarketFullyClosed(now);
}

/** @param {"kr"|"us"} market @param {Date} [now] */
export async function runGoldenCrossScanIfDue(market, now = new Date()) {
  if (!shouldRunGoldenCrossScan(market, now)) return null;
  const scanDate =
    market === "kr"
      ? getKstParts(now).dateKey
      : localMinutesOfDay("us", now).dateKey;

  clearGoldenCrossVaultItemsSync({ market });
  const result = await runGoldenCrossMarketScan(market, scanDate);
  if (result.hits.length) {
    mergeGoldenCrossHitsIntoVaultSync(result.hits);
  }
  appendGoldenCrossHistoryEntrySync({
    runId: randomUUID(),
    trigger: "scheduled",
    market,
    scanDate,
    scanned: result.scanned,
    hits: result.hits,
  });
  await notifyGoldenCrossScanTelegram(market, scanDate, result.hits);
  try {
    await sendGoldenCrossScanReportEmail({
      markets: [
        {
          market,
          scanDate,
          scanned: result.scanned,
          hits: result.hits,
        },
      ],
    });
  } catch (e) {
    liveTradeLogWarn(
      "[golden-cross:email]",
      market,
      e instanceof Error ? e.message : e,
    );
  }
  return result;
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
              hits: result.hitCount,
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
