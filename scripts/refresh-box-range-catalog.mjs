#!/usr/bin/env node
/** 박스권 카탈로그(Pine) 전 종목 갱신 — node scripts/refresh-box-range-catalog.mjs [--limit=N] */
import { loadEnvFile } from "../server/load-env.js";
import { loadUniverse } from "../server/universe.js";
import { scanOneSymbolCatalog } from "../server/box-range/catalog-scan-shared.js";
import { refreshCatalogIndexSync } from "../server/box-range/catalog-store.js";

loadEnvFile();

function parseLimit() {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--limit=")) {
      const n = Number(a.split("=")[1]);
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const limit = parseLimit();
const uni = await loadUniverse();
/** @type {{ symbol: string; name: string; market: "us"|"kr" }[]} */
let list = [
  ...(uni.us ?? []).map((s) => ({ ...s, market: /** @type {const} */ ("us") })),
  ...(uni.kr ?? []).map((s) => ({ ...s, market: /** @type {const} */ ("kr") })),
];
if (limit != null) list = list.slice(0, limit);

let ok = 0;
let err = 0;
const batch = 4;
const gapMs = 300;
const t0 = Date.now();

for (let i = 0; i < list.length; i += batch) {
  const chunk = list.slice(i, i + batch);
  const results = await Promise.all(
    chunk.map((item) => scanOneSymbolCatalog(item, item.market)),
  );
  for (const r of results) {
    if (r.ok) ok += 1;
    else err += 1;
  }
  const done = Math.min(i + batch.length, list.length);
  if (done % 50 === 0 || done === list.length) {
    console.log(`[box-range] ${done}/${list.length} ok=${ok} err=${err}`);
  }
  if (i + batch < list.length && gapMs > 0) await delay(gapMs);
}

for (const m of ["us", "kr"]) {
  refreshCatalogIndexSync(m);
}

const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`[box-range] done ${list.length} symbols · ok=${ok} err=${err} · ${sec}s`);
