import assert from "node:assert/strict";
import test from "node:test";
import {
  candleCalendarYear,
  computeHistoricalAveragePer,
} from "./value-invest-return-input.js";

test("candleCalendarYear — KST 일봉 객체", () => {
  assert.equal(candleCalendarYear({ time: { year: 2023, month: 6, day: 15 }, close: 100 }), 2023);
});

test("candleCalendarYear — unix seconds", () => {
  const sec = Math.floor(new Date("2024-07-01T00:00:00Z").getTime() / 1000);
  assert.equal(candleCalendarYear({ time: sec, close: 100 }), 2024);
});

test("computeHistoricalAveragePer — 일봉 객체 time + 다년 EPS", () => {
  const candles = [];
  for (const [year, price] of [
    [2022, 150],
    [2023, 165],
    [2024, 180],
  ]) {
    for (let m = 0; m < 12; m++) {
      candles.push({ time: { year, month: m + 1, day: 15 }, close: price });
    }
  }
  const epsHistory = [
    { year: 2022, eps: 10 },
    { year: 2023, eps: 11 },
    { year: 2024, eps: 12 },
  ];
  const r = computeHistoricalAveragePer(epsHistory, { candles });
  assert.equal(r.avg, 15);
  assert.equal(r.perByYear.length, 3);
  assert.match(r.source ?? "", /2022→2024/);
  assert.match(r.source ?? "", /3년/);
});

test("computeHistoricalAveragePer — 12년 PER 이력은 최근 10년만", () => {
  const candles = [];
  const epsHistory = [];
  for (let y = 2015; y <= 2024; y++) {
    epsHistory.push({ year: y, eps: 10 });
    candles.push({ time: { year: y, month: 6, day: 1 }, close: 150 });
  }
  const r = computeHistoricalAveragePer(epsHistory, { candles });
  assert.equal(r.perByYear.length, 10);
  assert.equal(r.perByYear[0].year, 2015);
  assert.equal(r.perByYear[9].year, 2024);
});
