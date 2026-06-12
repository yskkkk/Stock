import assert from "node:assert/strict";
import test from "node:test";
import {
  averageEpsFromHistory,
  EPS_AVERAGE_MAX_YEARS,
} from "./value-invest-eps-history.js";

test("averages up to 10 positive fiscal years", () => {
  const series = Array.from({ length: 12 }, (_, i) => ({
    year: 2014 + i,
    eps: 2 + i * 0.1,
  }));
  const r = averageEpsFromHistory(series);
  assert.equal(r.years.length, EPS_AVERAGE_MAX_YEARS);
  assert.equal(r.years[0].year, 2016);
  assert.equal(r.years[9].year, 2025);
  assert.ok(r.avg != null && r.avg > 2.4 && r.avg < 3.1);
  assert.match(r.source ?? "", /10개 실적/);
});

test("uses all years when listed less than 10 years", () => {
  const series = [
    { year: 2022, eps: 3 },
    { year: 2023, eps: 4 },
    { year: 2024, eps: 5 },
  ];
  const r = averageEpsFromHistory(series);
  assert.equal(r.years.length, 3);
  assert.equal(r.avg, 4);
  assert.match(r.source ?? "", /상장 10년 미만/);
});

test("skips non-positive eps years", () => {
  const r = averageEpsFromHistory([
    { year: 2020, eps: -1 },
    { year: 2021, eps: 2 },
    { year: 2022, eps: 4 },
  ]);
  assert.equal(r.years.length, 2);
  assert.equal(r.avg, 3);
});
