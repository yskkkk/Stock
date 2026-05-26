#!/usr/bin/env node
/**
 * Pine(f_zoneEngine) vs detect-pro — 종목/TF별 박스 개수 비교 리포트 생성
 *
 * 사용:
 *   node scripts/compare-box-range-detectors.mjs [--limit=80] [--market=us|kr|all]
 *
 * 환경:
 *   STOCK_BOX_RANGE_COMPARE_BATCH=4
 *   STOCK_BOX_RANGE_COMPARE_DELAY_MS=200
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../server/load-env.js";
import { loadUniverse } from "../server/universe.js";
import { loadCandlesForBoxScan } from "../server/box-range/catalog-scan-shared.js";
import { detectBoxRangesProOnCandles } from "../server/box-range/detect-pro.js";
import { detectBoxRangesPineOnCandles } from "../server/box-range/detect-pine.js";

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const out = { limit: null, market: "all" };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--limit=")) {
      const n = Number(a.split("=")[1]);
      out.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (a.startsWith("--market=")) {
      const m = String(a.split("=")[1] ?? "").trim().toLowerCase();
      out.market = m === "us" || m === "kr" ? m : "all";
    }
  }
  return out;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  const t = Number(ms);
  const lim = Number.isFinite(t) && t > 0 ? t : 15_000;
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`timeout:${label}:${lim}ms`)), lim),
    ),
  ]);
}

function tfList() {
  return /** @type {const} */ (["1h", "4h", "1d"]);
}

function pctDiff(a, b) {
  if (a === 0 && b === 0) return 0;
  const base = Math.max(1, a);
  return ((b - a) / base) * 100;
}

const args = parseArgs();
const BATCH = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_COMPARE_BATCH ?? 4);
  return Number.isFinite(n) && n >= 1 ? Math.min(12, Math.floor(n)) : 4;
})();
const GAP = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_COMPARE_DELAY_MS ?? 200);
  return Number.isFinite(n) && n >= 0 ? Math.min(5_000, Math.floor(n)) : 200;
})();
const TF_TIMEOUT_MS = (() => {
  const n = Number(process.env.STOCK_BOX_RANGE_COMPARE_TF_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(n) && n >= 2_000 ? Math.min(60_000, Math.floor(n)) : 15_000;
})();

/**
 * @param {{ symbol: string; name: string }} item
 * @returns {Promise<{ symbol: string; name: string; byTf: Record<string, { pro: number; pine: number }> }>}
 */
async function compareOne(item) {
  const symbol = String(item.symbol ?? "").trim().toUpperCase();
  const name = String(item.name ?? symbol).trim() || symbol;
  /** @type {Record<string, { pro: number; pine: number }>} */
  const byTf = {};
  for (const tf of tfList()) {
    try {
      const candles = await withTimeout(
        loadCandlesForBoxScan(symbol, tf),
        TF_TIMEOUT_MS,
        `${symbol}:${tf}:candles`,
      );
      if (!candles.length) {
        byTf[tf] = { pro: 0, pine: 0 };
        continue;
      }
      const pro = detectBoxRangesProOnCandles(candles, tf, 5).length;
      const pine = detectBoxRangesPineOnCandles(candles, tf, 5).length;
      byTf[tf] = { pro, pine };
    } catch {
      byTf[tf] = { pro: 0, pine: 0 };
    }
  }
  return { symbol, name, byTf };
}

function fmtRow(r) {
  const parts = [];
  for (const tf of tfList()) {
    const pro = r.byTf[tf]?.pro ?? 0;
    const pine = r.byTf[tf]?.pine ?? 0;
    const d = pine - pro;
    parts.push(`${tf}: ${pro} → ${pine} (${d >= 0 ? "+" : ""}${d})`);
  }
  return `- ${r.symbol} ${r.name}: ${parts.join(" · ")}`;
}

const uni = await loadUniverse();
const us = Array.isArray(uni?.us) ? uni.us : [];
const kr = Array.isArray(uni?.kr) ? uni.kr : [];

let target = [];
if (args.market === "us") target = us;
else if (args.market === "kr") target = kr;
else target = [...us, ...kr];

if (args.limit != null) target = target.slice(0, args.limit);

/** @type {any[]} */
const results = [];
const startedAt = Date.now();

for (let i = 0; i < target.length; i += BATCH) {
  const batch = target.slice(i, i + BATCH);
  const rows = await Promise.all(batch.map(compareOne));
  results.push(...rows);
  const done = Math.min(i + batch.length, target.length);
  const elapsed = Date.now() - startedAt;
  const per = done > 0 ? elapsed / done : 0;
  const etaMs = per > 0 ? Math.max(0, Math.round(per * (target.length - done))) : 0;
  if (done % Math.max(10, BATCH * 5) === 0 || done === target.length) {
    console.log(
      `[compare] ${done}/${target.length} (${Math.round((done / target.length) * 100)}%)` +
        ` elapsed=${Math.round(elapsed / 1000)}s` +
        ` eta=${Math.round(etaMs / 1000)}s`,
    );
  }
  if (i + BATCH < target.length && GAP > 0) await delay(GAP);
}

const changed = results.filter((r) =>
  tfList().some((tf) => (r.byTf[tf]?.pro ?? 0) !== (r.byTf[tf]?.pine ?? 0)),
);

const totals = {};
for (const tf of tfList()) totals[tf] = { pro: 0, pine: 0 };
for (const r of results) {
  for (const tf of tfList()) {
    totals[tf].pro += r.byTf[tf]?.pro ?? 0;
    totals[tf].pine += r.byTf[tf]?.pine ?? 0;
  }
}

const now = new Date();
const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const reportName = `BOX_RANGE_PINE_VS_PRO_${stamp}.md`;
const reportPath = path.join(__dirname, "..", reportName);

const lines = [];
lines.push(`## Pine(f_zoneEngine) vs detect-pro 박스권 개수 비교`);
lines.push(`- 생성: ${now.toISOString()}`);
lines.push(`- 대상: ${args.market} · ${results.length} symbols (limit=${args.limit ?? "none"})`);
lines.push("");
lines.push("### 총합(박스 개수)");
for (const tf of tfList()) {
  const a = totals[tf].pro;
  const b = totals[tf].pine;
  lines.push(
    `- ${tf}: pro=${a} / pine=${b} (Δ=${b - a}, ${pctDiff(a, b).toFixed(1)}%)`,
  );
}
lines.push("");
lines.push(`### 차이 있는 종목 (${changed.length}/${results.length})`);
for (const r of changed.slice(0, 180)) lines.push(fmtRow(r));
if (changed.length > 180) lines.push(`- … ${changed.length - 180} more`);
lines.push("");
lines.push("### 참고");
lines.push("- Pine 포팅: `server/box-range/detect-pine.js` (원본 `pine-horizontal-box-zones.pine`의 `f_zoneEngine`, 기본 pctLimit=false)");
lines.push("- pro 탐지: `server/box-range/detect-pro.js`");
lines.push("");

fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log("Wrote", reportPath);

