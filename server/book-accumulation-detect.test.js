import { test } from "vitest";
import assert from "node:assert/strict";
import {
  BOOK_ACCUM_SERVER_DEFAULTS,
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
