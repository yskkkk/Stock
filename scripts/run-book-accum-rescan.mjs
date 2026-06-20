#!/usr/bin/env node
/** 매집봉 전용 재스캔 — KR·US 일·주, vault 반영 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

function localUsDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const { getKstParts } = await import("../server/kr-business-day.js");
const {
  bookAccumFastScanEnabled,
  runBookAccumulationFastScan,
} = await import("../server/book-accumulation-fast-scan.js");

if (!bookAccumFastScanEnabled()) {
  console.error("[book-accum-rescan] STOCK_BOOK_ACCUM_FAST_SCAN=0 — 종료");
  process.exit(1);
}

const now = new Date();
/** @type {Array<"kr"|"us">} */
const markets = ["kr", "us"];

for (const market of markets) {
  const scanDate =
    market === "kr" ? getKstParts(now).dateKey : localUsDateKey(now);
  const t0 = Date.now();
  console.log(`[book-accum-rescan] ${market} start scanDate=${scanDate}`);
  const result = await runBookAccumulationFastScan({
    market,
    scanDate,
    mergeVault: true,
    persistState: true,
  });
  console.log(
    `[book-accum-rescan] ${market} done ${Math.round((Date.now() - t0) / 1000)}s`,
    JSON.stringify({
      scanned: result.scanned,
      hitCount: result.hitCount,
      errors: result.errors,
      durationMs: result.durationMs,
      timeframes: result.timeframes,
    }),
  );
}

console.log("[book-accum-rescan] all finished");
