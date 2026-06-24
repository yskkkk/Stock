import { test } from "vitest";
import assert from "node:assert/strict";
import {
  BOOK_ACCUM_MIN_CANDLES,
  BOOK_ACCUM_SERVER_DEFAULTS,
  detectBookAccumulationBars,
  detectBookAccumulationLatest,
  resolveBookAccumEffRvol,
} from "./book-accumulation-detect.js";

test("BOOK_ACCUM_SERVER_DEFAULTS matches user preset", () => {
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.preset, "느슨");
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.minRvol, 1.5);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.needDrop, false);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.needCostCtx, true);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.costTolPct, 5);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.pivotLen, 10);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.riseLb, 20);
  assert.equal(BOOK_ACCUM_SERVER_DEFAULTS.minRisePct, 5);
});

test("resolveBookAccumEffRvol uses minRvol for loose preset", () => {
  assert.equal(resolveBookAccumEffRvol("느슨", 1.5), 1.5);
  assert.equal(resolveBookAccumEffRvol("엄격", 1.5), 2.2);
});

test("detectBookAccumulationLatest returns empty below min candles", () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
    time: { year: 2026, month: 1, day: 1 + i },
  }));
  const hit = detectBookAccumulationLatest(candles);
  assert.equal(hit.anyAccum, false);
  assert.equal(hit.signalDate, null);
});

test("detectBookAccumulationLatest excludes long bearish bar on high RVOL", () => {
  const baseVol = 1_000_000;
  const candles = Array.from({ length: BOOK_ACCUM_MIN_CANDLES }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: baseVol,
    time: { year: 2026, month: 1, day: 1 + (i % 28) },
  }));
  const last = candles.length - 1;
  candles[last] = {
    open: 100,
    high: 100.5,
    low: 88,
    close: 90,
    volume: baseVol * 5,
    time: { year: 2026, month: 3, day: 15 },
  };
  const hit = detectBookAccumulationLatest(candles, {
    needCostCtx: false,
    needDrop: false,
  });
  assert.equal(hit.anyAccum, false);
});

test("detectBookAccumulationBars counts every qualifying bar in range", () => {
  const baseVol = 1_000_000;
  const candles = Array.from({ length: BOOK_ACCUM_MIN_CANDLES }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: baseVol,
    time: { year: 2026, month: 1, day: 1 + (i % 28) },
  }));
  const hiRvol = {
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: baseVol * 5,
  };
  candles[BOOK_ACCUM_MIN_CANDLES - 5] = {
    ...hiRvol,
    time: { year: 2026, month: 2, day: 10 },
  };
  candles[BOOK_ACCUM_MIN_CANDLES - 1] = {
    ...hiRvol,
    time: { year: 2026, month: 3, day: 15 },
  };
  const det = detectBookAccumulationBars(candles, {
    needCostCtx: false,
    needDrop: false,
    minScore: 30,
  });
  assert.ok(det.hitCount >= 2);
  assert.equal(det.hits[0].signalDate, "2026-02-10");
  assert.equal(det.latest?.signalDate, "2026-03-15");
});

test("detectBookAccumulationLatest allows short-body bearish (doji) bar", () => {
  const baseVol = 1_000_000;
  const candles = Array.from({ length: BOOK_ACCUM_MIN_CANDLES }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: baseVol,
    time: { year: 2026, month: 1, day: 1 + (i % 28) },
  }));
  const last = candles.length - 1;
  candles[last] = {
    open: 100,
    high: 101,
    low: 99,
    close: 99.8,
    volume: baseVol * 5,
    time: { year: 2026, month: 3, day: 15 },
  };
  const hit = detectBookAccumulationLatest(candles, {
    needCostCtx: false,
    needDrop: false,
    minScore: 30,
  });
  assert.equal(hit.anyAccum, true);
});
