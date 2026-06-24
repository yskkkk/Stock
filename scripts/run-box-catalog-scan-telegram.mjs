#!/usr/bin/env node
/**
 * 카탈로그 스캔 즉시 실행 + 텔레그램 알림 (us·kr)
 * Usage: node scripts/run-box-catalog-scan-telegram.mjs [us|kr|all]
 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const arg = (process.argv[2] ?? "all").trim().toLowerCase();

const { runKrBoxRangeCatalogScan } = await import(
  "../server/box-range/kr-scan-runner.js"
);
const { runSp500BoxRangeCatalogScan } = await import(
  "../server/box-range/sp500-scan-runner.js"
);

/** @type {Record<string, () => Promise<unknown>>} */
const runners = {
  kr: runKrBoxRangeCatalogScan,
  us: runSp500BoxRangeCatalogScan,
};

if (arg === "crypto") {
  console.error("[scan] crypto scan is disabled");
  process.exitCode = 1;
  process.exit(1);
}

const order =
  arg === "all" ? ["us", "kr"] : [arg in runners ? arg : "us"];

for (const key of order) {
  const fn = runners[key];
  if (!fn) continue;
  console.log(`[scan] ${key} start`);
  const out = await fn();
  console.log(`[scan] ${key} done`, JSON.stringify(out, null, 2));
}
