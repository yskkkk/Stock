/**
 * 실제 종목에서 매집봉 예시 + 주변 OHLC 추출 (최대 30건)
 * node scripts/export-book-accum-examples.mjs
 */
import { writeFileSync } from "node:fs";
import { loadUniverse } from "../server/universe.js";
import { loadStock } from "../server/stock-data.js";
import {
  BOOK_ACCUM_MIN_CANDLES,
  BOOK_ACCUM_SERVER_DEFAULTS,
  detectBookAccumulationLatest,
} from "../server/book-accumulation-detect.js";
import { candleTimeToDateKey } from "../server/golden-cross-detect.js";
import { resolveDisplayName } from "../server/names-ko.js";

const TARGET = 30;
const WINDOW_BEFORE = 12;
const WINDOW_AFTER = 3;

/** @param {unknown[]} candles @param {typeof BOOK_ACCUM_SERVER_DEFAULTS} opts */
function findLatestHitPerSymbol(candles, opts) {
  /** @type {{ index: number; score: number; rvol: number | null; signalDate: string }[]} */
  const hits = [];
  for (let i = BOOK_ACCUM_MIN_CANDLES - 1; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const hit = detectBookAccumulationLatest(slice, opts);
    if (hit.anyAccum && hit.signalDate) {
      hits.push({
        index: i,
        score: hit.score,
        rvol: hit.rvol,
        signalDate: hit.signalDate,
      });
    }
  }
  return hits;
}

/** @param {unknown} c */
function slimCandle(c) {
  const date = candleTimeToDateKey(c?.time);
  return {
    date,
    o: round(Number(c?.open)),
    h: round(Number(c?.high)),
    l: round(Number(c?.low)),
    c: round(Number(c?.close)),
    v: Math.round(Number(c?.volume) || 0),
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const uni = await loadUniverse();
const symbols = [
  ...uni.kr.slice(0, 120).map((s) => ({ ...s, market: "kr" })),
  ...uni.us.slice(0, 120).map((s) => ({ ...s, market: "us" })),
];

/** @type {unknown[]} */
const examples = [];
const seen = new Set();

for (const item of symbols) {
  if (examples.length >= TARGET) break;
  const sym = String(item.symbol ?? "").trim().toUpperCase();
  if (!sym || seen.has(sym)) continue;
  try {
    const data = await loadStock(sym, "1d", { live: false, scan: true });
    const candles = data?.candles;
    if (!Array.isArray(candles) || candles.length < BOOK_ACCUM_MIN_CANDLES) continue;

    const hits = findLatestHitPerSymbol(candles, BOOK_ACCUM_SERVER_DEFAULTS);
    if (!hits.length) continue;

    // 가장 최근 신호 1건만 (종목당)
    const hit = hits[hits.length - 1];
    const start = Math.max(0, hit.index - WINDOW_BEFORE);
    const end = Math.min(candles.length - 1, hit.index + WINDOW_AFTER);
    const window = candles.slice(start, end + 1).map(slimCandle);
    const signalIdx = hit.index - start;

    examples.push({
      symbol: sym,
      name: resolveDisplayName(sym, data?.quote?.name, item.name),
      market: item.market,
      signalDate: hit.signalDate,
      score: hit.score,
      rvol: hit.rvol,
      signalIndex: signalIdx,
      candles: window,
    });
    seen.add(sym);
    process.stderr.write(`+ ${sym} ${hit.signalDate} score=${hit.score}\n`);
  } catch (e) {
    process.stderr.write(`skip ${sym}: ${e instanceof Error ? e.message : e}\n`);
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  preset: BOOK_ACCUM_SERVER_DEFAULTS.preset,
  count: examples.length,
  examples,
};

const outPath = "scripts/book-accum-examples-30.json";
writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ path: outPath, count: examples.length }));
