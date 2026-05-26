#!/usr/bin/env node
/**
 * Pine 카탈로그 신규 경로 스캔 + legacy 대비 AS-IS / TO-BE 리포트·메일
 *
 * AS-IS: server/.data/box-range-catalog/
 * TO-BE: server/.data/box-range-catalog-pine/  (Pine f_zoneEngine 전체 차트)
 *
 * node scripts/scan-pine-catalog-as-is-to-be.mjs [--limit=N] [--skip-scan]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../server/load-env.js";
import { loadUniverse } from "../server/universe.js";
import { scanOneSymbolCatalog } from "../server/box-range/catalog-scan-shared.js";
import {
  BOX_RANGE_CATALOG_DIR_LEGACY,
  BOX_RANGE_CATALOG_DIR_PINE,
} from "../server/box-range/constants.js";
import {
  readSymbolCatalogSync,
  summarizeCatalogRootSync,
} from "../server/box-range/catalog-store.js";
import { resolveServerDataDir } from "../server/data-path.js";

loadEnvFile();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TO_EMAIL = String(process.env.BOX_RANGE_REPORT_EMAIL ?? "samron3@naver.com").trim();

function parseArgs() {
  let limit = null;
  let skipScan = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--limit=")) {
      const n = Number(a.split("=")[1]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
    if (a === "--skip-scan") skipScan = true;
  }
  return { limit, skipScan };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pctDelta(asIs, toBe) {
  if (asIs === 0 && toBe === 0) return "0%";
  const base = Math.max(1, asIs);
  return `${(((toBe - asIs) / base) * 100).toFixed(1)}%`;
}

function countBySymbol(legacyRoot, pineRoot, symbol, market) {
  const leg = readSymbolCatalogSync(symbol, market, legacyRoot);
  const pine = readSymbolCatalogSync(symbol, market, pineRoot);
  /** @type {Record<string, { asIs: number; toBe: number }>} */
  const byTf = {};
  for (const tf of ["1h", "4h", "1d"]) {
    byTf[tf] = {
      asIs: leg?.boxes?.filter((b) => b.timeframe === tf).length ?? 0,
      toBe: pine?.boxes?.filter((b) => b.timeframe === tf).length ?? 0,
    };
  }
  const asIs = leg?.boxes?.length ?? 0;
  const toBe = pine?.boxes?.length ?? 0;
  return { asIs, toBe, byTf, name: pine?.name ?? leg?.name ?? symbol };
}

async function runScan(list, batch = 4, gapMs = 300) {
  process.env.STOCK_BOX_RANGE_CATALOG_DIR = BOX_RANGE_CATALOG_DIR_PINE;
  let ok = 0;
  let err = 0;
  for (let i = 0; i < list.length; i += batch) {
    const batchItems = list.slice(i, i + batch);
    const results = await Promise.all(
      batchItems.map((item) => scanOneSymbolCatalog(item, item.market ?? "us")),
    );
    for (const r of results) {
      if (r.ok) ok += 1;
      else err += 1;
    }
    const done = Math.min(i + batch.length, list.length);
    if (done % 40 === 0 || done === list.length) {
      console.log(`[pine-scan] ${done}/${list.length} ok=${ok} err=${err}`);
    }
    if (i + batch < list.length && gapMs > 0) await delay(gapMs);
  }
  return { ok, err, total: list.length };
}

const { limit, skipScan } = parseArgs();
const dataDir = resolveServerDataDir();
const legacyRoot = BOX_RANGE_CATALOG_DIR_LEGACY;
const pineRoot = BOX_RANGE_CATALOG_DIR_PINE;

const uni = await loadUniverse();
/** @type {{ symbol: string; name: string; market: "us"|"kr" }[]} */
let symbols = [
  ...(uni.us ?? []).map((s) => ({ ...s, market: /** @type {const} */ ("us") })),
  ...(uni.kr ?? []).map((s) => ({ ...s, market: /** @type {const} */ ("kr") })),
];
if (limit != null) symbols = symbols.slice(0, limit);

let scanStats = { ok: 0, err: 0, total: 0, skipped: true };
if (!skipScan) {
  console.log(`Scanning TO-BE → ${path.join(dataDir, pineRoot)}`);
  scanStats = { ...(await runScan(symbols)), skipped: false };
  for (const m of ["us", "kr"]) {
    const { refreshCatalogIndexSync } = await import(
      "../server/box-range/catalog-store.js"
    );
    process.env.STOCK_BOX_RANGE_CATALOG_DIR = pineRoot;
    refreshCatalogIndexSync(m, pineRoot);
  }
}

const legUs = summarizeCatalogRootSync(legacyRoot, "us");
const legKr = summarizeCatalogRootSync(legacyRoot, "kr");
const pineUs = summarizeCatalogRootSync(pineRoot, "us");
const pineKr = summarizeCatalogRootSync(pineRoot, "kr");

const totals = {
  asIs: legUs.total + legKr.total,
  toBe: pineUs.total + pineKr.total,
};
for (const tf of ["1h", "4h", "1d"]) {
  totals[`asIs_${tf}`] = legUs.byTf[tf] + legKr.byTf[tf];
  totals[`toBe_${tf}`] = pineUs.byTf[tf] + pineKr.byTf[tf];
}

/** @type {typeof symbols} */
const changed = [];
for (const item of symbols) {
  const c = countBySymbol(legacyRoot, pineRoot, item.symbol, item.market);
  if (c.asIs !== c.toBe) {
    changed.push({ ...item, ...c });
  }
}

const now = new Date();
const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const reportName = `BOX_RANGE_CATALOG_ASIS_TOBE_${stamp}.md`;
const reportPath = path.join(__dirname, "..", reportName);

const lines = [];
lines.push("# 박스권 카탈로그 AS-IS / TO-BE 보고서");
lines.push("");
lines.push(`- 생성: ${now.toISOString()}`);
lines.push(`- 수신: ${TO_EMAIL}`);
lines.push("");
lines.push("## 요약");
lines.push("");
lines.push("| 구분 | 저장 경로 | 탐지 방식 |");
lines.push("|------|-----------|-----------|");
lines.push(
  `| **AS-IS** | \`${legacyRoot}\` | 기존 카탈로그(legacy detect-pro·overlap merge 누적) |`,
);
lines.push(
  `| **TO-BE** | \`${pineRoot}\` | Pine \`f_zoneEngine\` 전체 차트 1회 탐지·TF별 교체 저장 |`,
);
lines.push("");
if (!scanStats.skipped) {
  lines.push(
    `- TO-BE 스캔: ${scanStats.total}종목 · 성공 ${scanStats.ok} · 실패 ${scanStats.err}`,
  );
} else {
  lines.push("- TO-BE 스캔: 생략(`--skip-scan`) — 기존 pine 경로 데이터 사용");
}
lines.push(`- 비교 대상: ${symbols.length}종목 · 박스 수 차이 ${changed.length}종목`);
lines.push("");
lines.push("## 총 박스 개수 (AS-IS → TO-BE)");
lines.push("");
lines.push(
  `| 구간 | AS-IS | TO-BE | Δ | 변화율 |`,
);
lines.push(
  `|------|------:|------:|--:|------:|`,
);
lines.push(
  `| **전체** | ${totals.asIs} | ${totals.toBe} | ${totals.toBe - totals.asIs} | ${pctDelta(totals.asIs, totals.toBe)} |`,
);
for (const tf of ["1h", "4h", "1d"]) {
  const a = totals[`asIs_${tf}`];
  const b = totals[`toBe_${tf}`];
  lines.push(
    `| ${tf} | ${a} | ${b} | ${b - a} | ${pctDelta(a, b)} |`,
  );
}
lines.push("");
lines.push("## 시장별");
lines.push("");
for (const [label, leg, pine] of [
  ["US", legUs, pineUs],
  ["KR", legKr, pineKr],
]) {
  lines.push(`### ${label}`);
  lines.push(
    `- AS-IS: 종목 ${leg.symbols} · 박스 있음 ${leg.withBoxes} · 총 ${leg.total}박스`,
  );
  lines.push(
    `- TO-BE: 종목 ${pine.symbols} · 박스 있음 ${pine.withBoxes} · 총 ${pine.total}박스`,
  );
  lines.push(
    `- TF: 1h ${leg.byTf["1h"]}→${pine.byTf["1h"]} · 4h ${leg.byTf["4h"]}→${pine.byTf["4h"]} · 1d ${leg.byTf["1d"]}→${pine.byTf["1d"]}`,
  );
  lines.push("");
}
lines.push(`## 박스 수가 달라진 종목 (상위 ${Math.min(120, changed.length)} / ${changed.length})`);
lines.push("");
for (const r of changed
  .sort((a, b) => Math.abs(b.toBe - b.asIs) - Math.abs(a.toBe - a.asIs))
  .slice(0, 120)) {
  const parts = ["1h", "4h", "1d"].map((tf) => {
    const a = r.byTf[tf].asIs;
    const b = r.byTf[tf].toBe;
    return `${tf}:${a}→${b}`;
  });
  lines.push(`- **${r.symbol}** ${r.name}: 전체 ${r.asIs}→${r.toBe} (${parts.join(" · ")})`);
}
if (changed.length > 120) {
  lines.push(`- … 외 ${changed.length - 120}종목`);
}
lines.push("");
lines.push("## TO-BE 전환 시 참고");
lines.push("");
lines.push("- TO-BE 경로는 **30분 스캔·실시간 탐지가 아직 legacy 경로를 쓰는 경우** 운영 전환 시 `STOCK_BOX_RANGE_CATALOG_DIR=box-range-catalog-pine` 설정 필요");
lines.push("- OHLC는 Yahoo(서버) vs TradingView 시세 차이로 동일 로직이라도 일부 종목은 여전히 수치 차이 가능");
lines.push("");

fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
console.log("Wrote", reportPath);

const { spawn } = await import("node:child_process");
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["scripts/send-report-email.mjs", TO_EMAIL, reportPath],
    { cwd: path.join(__dirname, ".."), stdio: "inherit" },
  );
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`email exit ${code}`)),
  );
});
