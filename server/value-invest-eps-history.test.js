import { describe, it, expect } from "vitest";
import {
  averageEpsFromHistory,
  EPS_AVERAGE_MAX_YEARS,
} from "./value-invest-eps-history.js";

describe("averageEpsFromHistory", () => {
  it("10년 전 EPS + 최근 EPS ÷ 2", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      year: 2014 + i,
      eps: 2 + i * 0.1,
    }));
    const r = averageEpsFromHistory(series);
    expect(r.years).toEqual([
      { year: 2015, eps: 2.1 },
      { year: 2025, eps: 3.1 },
    ]);
    expect(r.avg).toBeCloseTo((2.1 + 3.1) / 2, 5);
    expect(r.source).toMatch(/2015 \+ 2025.*÷ 2/);
  });

  it("상장 10년 미만 — 가장 오래된 EPS + 최근 EPS", () => {
    const series = [
      { year: 2022, eps: 3 },
      { year: 2023, eps: 4 },
      { year: 2024, eps: 5 },
    ];
    const r = averageEpsFromHistory(series);
    expect(r.years).toEqual([
      { year: 2022, eps: 3 },
      { year: 2024, eps: 5 },
    ]);
    expect(r.avg).toBe(4);
    expect(r.source).toMatch(/실제 2년 간격/);
  });

  it("음수·0 EPS 연도 제외", () => {
    const r = averageEpsFromHistory([
      { year: 2020, eps: -1 },
      { year: 2021, eps: 2 },
      { year: 2022, eps: 4 },
    ]);
    expect(r.years).toEqual([
      { year: 2021, eps: 2 },
      { year: 2022, eps: 4 },
    ]);
    expect(r.avg).toBe(3);
  });

  it("빈 배열 — avg null", () => {
    const r = averageEpsFromHistory([]);
    expect(r.avg).toBeNull();
    expect(r.years.length).toBe(0);
  });

  it("모두 음수 — avg null", () => {
    const r = averageEpsFromHistory([
      { year: 2022, eps: -5 },
      { year: 2023, eps: -3 },
    ]);
    expect(r.avg).toBeNull();
  });

  it("year 0인 항목 제외", () => {
    const r = averageEpsFromHistory([
      { year: 0, eps: 100 },
      { year: 2023, eps: 5 },
      { year: 2024, eps: 7 },
    ]);
    expect(r.years).toEqual([
      { year: 2023, eps: 5 },
      { year: 2024, eps: 7 },
    ]);
    expect(r.avg).toBe(6);
  });

  it("null 인자 처리", () => {
    const r = averageEpsFromHistory(/** @type {any} */ (null));
    expect(r.avg).toBeNull();
  });

  it("정확히 10년 — 2014·2024 두 연도 사용", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      year: 2015 + i,
      eps: 10,
    }));
    const r = averageEpsFromHistory(series);
    expect(r.years).toEqual([
      { year: 2015, eps: 10 },
      { year: 2024, eps: 10 },
    ]);
    expect(r.avg).toBe(10);
    expect(r.source).toMatch(/2015 \+ 2024.*÷ 2/);
    expect(r.source).not.toMatch(/API 가용/);
  });

  it("1개만 있으면 해당값", () => {
    const r = averageEpsFromHistory([{ year: 2024, eps: 7.5 }]);
    expect(r.avg).toBe(7.5);
    expect(r.years.length).toBe(1);
  });

  it("연도 역순 입력 — 정렬 후 10년 전·최근 사용", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      year: 2025 - i,
      eps: 5 + i * 0.1,
    }));
    const r = averageEpsFromHistory(series);
    expect(r.years[0].year).toBe(2015);
    expect(r.years[1].year).toBe(2025);
    expect(r.avg).toBeCloseTo((6 + 5) / 2, 5);
  });

  it(`maxYears 기본값 ${EPS_AVERAGE_MAX_YEARS}`, () => {
    const series = [
      { year: 2010, eps: 1 },
      { year: 2020, eps: 3 },
      { year: 2025, eps: 5 },
    ];
    const r = averageEpsFromHistory(series);
    expect(r.years).toEqual([
      { year: 2010, eps: 1 },
      { year: 2025, eps: 5 },
    ]);
    expect(r.avg).toBe(3);
  });
});
