#!/usr/bin/env node
/**
 * 범위 내 전 종목 박스권 카탈로그 스캔 → 결과 메일
 *
 *   node scripts/run-full-box-range-scan-and-email.mjs
 *   node scripts/run-full-box-range-scan-and-email.mjs --to samron3@naver.com
 */
import { loadEnvFile } from "../server/load-env.js";
import { loadUniverse } from "../server/universe.js";
import { runKrBoxRangeCatalogScan } from "../server/box-range/kr-scan-runner.js";
import { runSp500BoxRangeCatalogScan } from "../server/box-range/sp500-scan-runner.js";
import {
  CATALOG_MARKETS,
  refreshCatalogIndexSync,
} from "../server/box-range/catalog-store.js";
import {
  DEFAULT_AUDIT_REPORT_TO,
  sendBoxRangeCatalogListEmail,
} from "../server/notifications/box-range-catalog-list-email.js";

loadEnvFile();

const args = process.argv.slice(2);
let to = process.env.STOCK_AUDIT_REPORT_TO?.trim() || DEFAULT_AUDIT_REPORT_TO;
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) {
  to = String(args[toIdx + 1]).trim();
}

const skipScan = args.includes("--email-only");

console.log("[box-range:full-scan] loading universe…");
const uni = await loadUniverse();
const universeInfo = {
  kr: uni.kr?.length ?? 0,
  us: uni.us?.length ?? 0,
};

/** @type {{ kr?: object; us?: object }} */
const scanResult = {};

if (!skipScan) {
  console.log(
    `[box-range:full-scan] KR ${universeInfo.kr} + US ${universeInfo.us} symbols…`,
  );
  const t0 = Date.now();
  scanResult.kr = await runKrBoxRangeCatalogScan();
  console.log("[box-range:full-scan] KR done", scanResult.kr);
  scanResult.us = await runSp500BoxRangeCatalogScan();
  console.log("[box-range:full-scan] US done", scanResult.us);
  for (const m of CATALOG_MARKETS) {
    refreshCatalogIndexSync(m);
  }
  scanResult.elapsedMs = Date.now() - t0;
}

const out = await sendBoxRangeCatalogListEmail({
  to,
  scanMeta: { universe: universeInfo, scan: scanResult },
});
console.log(JSON.stringify(out, null, 2));
