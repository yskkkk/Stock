import { test } from "vitest";
import assert from "node:assert/strict";
import { trimPartialWeeklyCandle } from "./weekly-candle-trim.js";

test("trimPartialWeeklyCandle drops weekly bar newer than last daily", () => {
  const weekly = [
    { time: { year: 2026, month: 6, day: 1 }, close: 10 },
    { time: { year: 2026, month: 6, day: 8 }, close: 11 },
    { time: { year: 2026, month: 6, day: 10 }, close: 12 },
  ];
  const daily = [{ time: { year: 2026, month: 6, day: 8 }, close: 11 }];
  const out = trimPartialWeeklyCandle(weekly, daily);
  assert.equal(out.length, 2);
  assert.equal(out.at(-1)?.time?.day, 8);
});

test("trimPartialWeeklyCandle keeps weekly when not ahead of daily", () => {
  const weekly = [
    { time: { year: 2026, month: 6, day: 1 }, close: 10 },
    { time: { year: 2026, month: 6, day: 8 }, close: 11 },
  ];
  const daily = [{ time: { year: 2026, month: 6, day: 8 }, close: 11 }];
  assert.equal(trimPartialWeeklyCandle(weekly, daily).length, 2);
});
