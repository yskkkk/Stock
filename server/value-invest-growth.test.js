import { describe, expect, it } from "vitest";
import {
  epsCagrFromHistory,
  epsGrowthWindow,
  deriveValueInvestGrowth10y,
  GROWTH_10Y_CAP,
} from "./value-invest-growth.js";

function cagr(startEps, endEps, periodYears) {
  return (endEps / startEps) ** (1 / periodYears) - 1;
}

describe("epsCagrFromHistory", () => {
  it("3개 연도 — 구간 CAGR (2022→2024)", () => {
    const r = epsCagrFromHistory([
      { year: 2022, eps: 6 },
      { year: 2023, eps: 7 },
      { year: 2024, eps: 7.5 },
    ]);
    expect(r).not.toBeNull();
    expect(r).toBeCloseTo(cagr(6, 7.5, 2), 4);
  });

  it("2개 연도 — 1년 CAGR = YoY", () => {
    const r = epsCagrFromHistory([
      { year: 2023, eps: 10 },
      { year: 2024, eps: 12 },
    ]);
    expect(r).toBeCloseTo(0.2, 4);
  });

  it("1개 연도만 있으면 null", () => {
    expect(epsCagrFromHistory([{ year: 2024, eps: 10 }])).toBeNull();
  });

  it("10개 연도 — 2015→2024 9년 CAGR", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      year: 2015 + i,
      eps: 5 + i,
    }));
    const r = epsCagrFromHistory(series);
    expect(r).toBeCloseTo(cagr(5, 14, 9), 4);
  });

  it("5개 연도 — 2020→2024 4년 CAGR", () => {
    const r = epsCagrFromHistory([
      { year: 2020, eps: 100 },
      { year: 2021, eps: 50 },
      { year: 2022, eps: 30 },
      { year: 2023, eps: 8 },
      { year: 2024, eps: 10 },
    ]);
    expect(r).toBeCloseTo(cagr(100, 10, 4), 4);
  });

  it("불규칙 성장 — 2021→2023 2년 CAGR", () => {
    const r = epsCagrFromHistory([
      { year: 2021, eps: 5 },
      { year: 2022, eps: 15 },
      { year: 2023, eps: 18 },
    ]);
    expect(r).toBeCloseTo(cagr(5, 18, 2), 4);
  });
});

describe("deriveValueInvestGrowth10y", () => {
  it("이력 있으면 EPS CAGR 우선", () => {
    const r = deriveValueInvestGrowth10y({
      eps: 8,
      forwardEps: 9,
      revenueGrowth: null,
      epsHistory: [
        { year: 2023, eps: 10 },
        { year: 2024, eps: 11 },
      ],
    });
    expect(r.value).toBeCloseTo(0.1, 4);
    expect(r.source).toMatch(/CAGR/);
  });

  it("1년 50% → 25% 상한", () => {
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: [
        { year: 2023, eps: 10 },
        { year: 2024, eps: 15 },
      ],
    });
    expect(r.value).toBe(GROWTH_10Y_CAP);
  });

  it("반도체 사이클 — CAGR은 YoY 급등보다 완만", () => {
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: [
        { year: 2021, eps: 5765 },
        { year: 2022, eps: 8057 },
        { year: 2023, eps: 1457 },
        { year: 2024, eps: 6253 },
      ],
    });
    expect(r.value).toBeCloseTo(cagr(5765, 6253, 3), 4);
    expect(r.value).toBeLessThan(GROWTH_10Y_CAP);
  });
});

describe("epsGrowthWindow", () => {
  it("최대 10년 창", () => {
    const series = Array.from({ length: 12 }, (_, i) => ({
      year: 2013 + i,
      eps: 100 + i,
    }));
    const w = epsGrowthWindow(series);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.start.year).toBe(2015);
    expect(w.end.year).toBe(2024);
    expect(w.periodYears).toBe(9);
  });
});
