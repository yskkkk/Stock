/**
 * 탐색 리포트 이메일 — 같은 시간대(짧은 settle) 스캔 결과를 1통으로 합침.
 */
import { sendGoldenCrossScanReportEmailNow } from "./golden-cross-scan-email.js";

function settleMs() {
  const n = Number(process.env.STOCK_SCAN_REPORT_SETTLE_MS ?? 15_000);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120_000) : 15_000;
}

function maxWaitMs() {
  const n = Number(process.env.STOCK_SCAN_REPORT_COALESCE_MAX_MS ?? 180_000);
  const settle = settleMs();
  return Number.isFinite(n) && n >= settle ? Math.min(n, 600_000) : 180_000;
}

/** @param {unknown[] | undefined} a @param {unknown[] | undefined} b */
function concatArrays(a, b) {
  return [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
}

/**
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} add
 */
function mergeScanReportOpts(base, add) {
  return {
    goldenCross: concatArrays(
      /** @type {unknown[]} */ (base.goldenCross),
      /** @type {unknown[]} */ (add.goldenCross),
    ),
    maAlign: concatArrays(
      /** @type {unknown[]} */ (base.maAlign),
      /** @type {unknown[]} */ (add.maAlign),
    ),
    ma120Near: concatArrays(
      /** @type {unknown[]} */ (base.ma120Near),
      /** @type {unknown[]} */ (add.ma120Near),
    ),
    bookAccum: concatArrays(
      /** @type {unknown[]} */ (base.bookAccum),
      /** @type {unknown[]} */ (add.bookAccum),
    ),
    lowSlopeFlip: concatArrays(
      concatArrays(
        /** @type {unknown[]} */ (base.lowSlopeFlip),
        /** @type {unknown[]} */ (add.lowSlopeFlip),
      ),
      /** @type {unknown[]} */ (add.lowSlope),
    ),
    bottomCandle: concatArrays(
      /** @type {unknown[]} */ (base.bottomCandle),
      /** @type {unknown[]} */ (add.bottomCandle),
    ),
    markets: concatArrays(
      /** @type {unknown[]} */ (base.markets),
      /** @type {unknown[]} */ (add.markets),
    ),
    dryRun: Boolean(add.dryRun ?? base.dryRun),
    to: add.to ?? base.to,
  };
}

/** @type {{ opts: Record<string, unknown>; firstAtMs: number; lastAtMs: number } | null} */
let pending = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;

let flushInFlight = false;

function scheduleSettleFlush(ms = settleMs()) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushScanReportEmailNow();
  }, ms);
}

/**
 * @param {Parameters<typeof sendGoldenCrossScanReportEmailNow>[0] & {
 *   immediate?: boolean;
 * }} opts
 */
export async function queueScanReportEmail(opts) {
  if (opts?.immediate || opts?.dryRun) {
    return sendGoldenCrossScanReportEmailNow(opts);
  }

  const now = Date.now();
  const slice = { ...opts };
  delete slice.immediate;

  if (!pending) {
    pending = { opts: slice, firstAtMs: now, lastAtMs: now };
  } else {
    pending.opts = mergeScanReportOpts(pending.opts, slice);
    pending.lastAtMs = now;
  }

  if (now - pending.firstAtMs >= maxWaitMs()) {
    return flushScanReportEmailNow();
  }

  scheduleSettleFlush();
  return { queued: true, coalesced: true };
}

/** 스캔 1회 종료 — settle 후 발송(그 사이 다른 스캔이 오면 합침) */
export function endScanReportCoalesceWindow() {
  if (!pending) return;
  scheduleSettleFlush(settleMs());
}

/** 대기 중 리포트 즉시 발송(일괄 스캔 마침 등) */
export async function flushScanReportEmailNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending) {
    return { queued: false, sent: 0, reason: "empty" };
  }
  if (flushInFlight) {
    return { queued: true, sent: 0, reason: "flush_busy" };
  }

  flushInFlight = true;
  const snapshot = pending;
  pending = null;
  try {
    const result = await sendGoldenCrossScanReportEmailNow(
      /** @type {Parameters<typeof sendGoldenCrossScanReportEmailNow>[0]} */ (
        snapshot.opts
      ),
    );
    return { ...result, queued: false, flushed: true };
  } finally {
    flushInFlight = false;
  }
}

/** @type {typeof queueScanReportEmail} */
export const sendGoldenCrossScanReportEmail = queueScanReportEmail;
