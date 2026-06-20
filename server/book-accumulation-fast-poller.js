import { Worker } from "node:worker_threads";
import {
  bookAccumFastScanEnabled,
  getBookAccumulationFastScanStateSync,
  BOOK_ACCUM_FAST_TIMEFRAMES,
} from "./book-accumulation-fast-scan.js";
import { BOOK_ACCUM_US_UNIVERSE_SCOPE } from "./universe.js";
import { liveTradeLogInfo, liveTradeLogWarn } from "./live-trade-log.js";

const WORKER_URL = new URL("./book-accumulation-fast-worker.js", import.meta.url);
const WORKER_TIMEOUT_MS = (() => {
  const n = Number(process.env.STOCK_BOOK_ACCUM_FAST_TIMEOUT_MS ?? 240 * 60_000);
  return Number.isFinite(n) && n >= 60_000 ? Math.min(n, 360 * 60_000) : 240 * 60_000;
})();

let fastScanRunning = false;
/** @type {{ atMs: number; result: object } | null} */
let lastFastScanResult = null;

export function isBookAccumFastScanRunning() {
  return fastScanRunning;
}

export function getLastBookAccumFastScanResult() {
  return lastFastScanResult;
}

/**
 * @param {import("./book-accumulation-fast-scan.js").runBookAccumulationFastScan extends (...args: any[]) => Promise<infer R> ? Parameters<typeof import("./book-accumulation-fast-scan.js").runBookAccumulationFastScan>[0] : never} scanOpts
 */
function spawnBookAccumFastScanWorker(scanOpts) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { workerData: scanOpts });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("[book-accum:fast] worker timeout"));
    }, WORKER_TIMEOUT_MS);
    worker.once("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      if (msg.ok) resolve(msg.result);
      else reject(new Error(msg.error ?? "worker failed"));
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`[book-accum:fast] worker exit ${code}`));
    });
  });
}

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * @param {{ mergeVault?: boolean }} [body]
 * @returns {{ started: boolean; reason?: string }}
 */
export function triggerBookAccumFastScan(body = {}) {
  if (!bookAccumFastScanEnabled()) {
    return { started: false, reason: "disabled" };
  }
  if (fastScanRunning) {
    return { started: false, reason: "busy" };
  }

  const now = new Date();
  const scanDate = localUsDateKey(now);

  const scanOpts = {
    scope: BOOK_ACCUM_US_UNIVERSE_SCOPE,
    market: "us",
    scanDate,
    timeframes: [...BOOK_ACCUM_FAST_TIMEFRAMES],
    mergeVault: body.mergeVault !== false,
  };

  fastScanRunning = true;
  liveTradeLogInfo("[book-accum:fast] trigger", scanOpts);

  void spawnBookAccumFastScanWorker(scanOpts)
    .then((result) => {
      lastFastScanResult = { atMs: Date.now(), result };
      liveTradeLogInfo("[book-accum:fast] worker done", {
        scanned: result.scanned,
        hitCount: result.hitCount,
        durationMs: result.durationMs,
      });
    })
    .catch((e) => {
      liveTradeLogWarn(
        "[book-accum:fast]",
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => {
      fastScanRunning = false;
    });

  return { started: true };
}
