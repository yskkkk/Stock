#!/usr/bin/env node
/**
 * 카탈로그 스캔 즉시 실행 + 텔레그램 알림 (us·kr·crypto)
 * Usage: node scripts/run-box-catalog-scan-telegram.mjs [us|kr|crypto|all]
 */
import { loadEnvFile } from "../server/load-env.js";

loadEnvFile();

const arg = (process.argv[2] ?? "all").trim().toLowerCase();

const { runCryptoBoxRangeCatalogScan } = await import(
  "../server/box-range/crypto-scan-runner.js"
);
const { runKrBoxRangeCatalogScan } = await import(
  "../server/box-range/kr-scan-runner.js"
);
const { runSp500BoxRangeCatalogScan } = await import(
  "../server/box-range/sp500-scan-runner.js"
);

/** @type {Record<string, () => Promise<unknown>>} */
const runners = {
  crypto: runCryptoBoxRangeCatalogScan,
  kr: runKrBoxRangeCatalogScan,
  us: runSp500BoxRangeCatalogScan,
};

const order =
  arg === "all" ? ["crypto", "kr", "us"] : [arg in runners ? arg : "crypto"];

for (const key of order) {
  const fn = runners[key];
  if (!fn) continue;
  console.log(`[scan] ${key} start`);
  const out = await fn();
  console.log(`[scan] ${key} done`, JSON.stringify(out, null, 2));
}
