import { describe, expect, it } from "vitest";
import {
  buildEpsGrowthByYear,
  GROWTH_10Y_CAP,
  epsAvgYoyGrowthFromHistory,
  epsCagrFromHistory,
  epsGrowthWindow,
  deriveValueInvestGrowth10y,
} from "./value-invest-growth.js";

function cagr(startEps, endEps, periodYears) {
  return (endEps / startEps) ** (1 / periodYears) - 1;
}

function avgYoy(series) {
  const sorted = series
    .filter((s) => s.year > 0 && s.eps > 0)
    .sort((a, b) => a.year - b.year);
  const rates = [];
  for (let i = 1; i < sorted.length; i++) {
    rates.push(sorted[i].eps / sorted[i - 1].eps - 1);
  }
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

describe("buildEpsGrowthByYear", () => {
  it("첫 해 YoY null, 이후 전년대비 %", () => {
    const rows = buildEpsGrowthByYear([
      { year: 2023, eps: 2131 },
      { year: 2024, eps: 4950 },
      { year: 2025, eps: 6564 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0].yoyPct).toBeNull();
    expect(rows[1].yoyPct).toBeCloseTo(((4950 / 2131) - 1) * 100, 2);
    expect(rows[2].yoyPct).toBeCloseTo(((6564 / 4950) - 1) * 100, 2);
  });
});

describe("epsAvgYoyGrowthFromHistory", () => {
  it("3개 연도 — 전년대비 2개 평균", () => {
    const series = [
      { year: 2022, eps: 6 },
      { year: 2023, eps: 7 },
      { year: 2024, eps: 7.5 },
    ];
    const r = epsAvgYoyGrowthFromHistory(series);
    expect(r).not.toBeNull();
    expect(r).toBeCloseTo(avgYoy(series), 4);
  });

  it("2개 연도 — 1년 YoY", () => {
    const series = [
      { year: 2023, eps: 10 },
      { year: 2024, eps: 12 },
    ];
    expect(epsAvgYoyGrowthFromHistory(series)).toBeCloseTo(0.2, 4);
  });

  it("1개 연도만 있으면 null", () => {
    expect(epsAvgYoyGrowthFromHistory([{ year: 2024, eps: 10 }])).toBeNull();
  });

  it("10개 연도 — 구간 내 전년대비 평균", () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      year: 2015 + i,
      eps: 5 + i,
    }));
    const r = epsAvgYoyGrowthFromHistory(series);
    expect(r).toBeCloseTo(avgYoy(series), 4);
    expect(r).not.toBeCloseTo(cagr(5, 14, 9), 4);
  });

  it("불규칙 성장 — CAGR과 다른 산술평균", () => {
    const series = [
      { year: 2021, eps: 5 },
      { year: 2022, eps: 15 },
      { year: 2023, eps: 18 },
    ];
    const r = epsAvgYoyGrowthFromHistory(series);
    expect(r).toBeCloseTo(avgYoy(series), 4);
    expect(r).not.toBeCloseTo(cagr(5, 18, 2), 4);
  });
});

describe("epsCagrFromHistory", () => {
  it("CAGR은 여전히 별도 함수로 유지", () => {
    const series = [
      { year: 2020, eps: 100 },
      { year: 2021, eps: 50 },
      { year: 2022, eps: 30 },
      { year: 2023, eps: 8 },
      { year: 2024, eps: 10 },
    ];
    expect(epsCagrFromHistory(series)).toBeCloseTo(cagr(100, 10, 4), 4);
  });
});

describe("deriveValueInvestGrowth10y", () => {
  it("이력 있으면 EPS 전년대비 평균 우선", () => {
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
    expect(r.source).toMatch(/전년대비 평균/);
  });

  it("4년 이상 이력 — 전년대비 평균 (상한 없음)", () => {
    const series = [
      { year: 2020, eps: 8 },
      { year: 2021, eps: 9 },
      { year: 2022, eps: 10 },
      { year: 2023, eps: 15 },
    ];
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: series,
    });
    expect(r.value).toBeCloseTo(avgYoy(series), 4);
  });

  it("3년 이하 이력 — 25% 상한", () => {
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: [
        { year: 2023, eps: 2131 },
        { year: 2024, eps: 4950 },
        { year: 2025, eps: 6564 },
      ],
    });
    expect(r.value).toBe(GROWTH_10Y_CAP);
    expect(r.source).toMatch(/10년 상한 25%/);
    expect(r.warnings[0]).toMatch(/단기 이력 3년/);
  });

  it("NVIDIA 1년 급성장 — 2년 이력이면 25% 상한", () => {
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: [
        { year: 2023, eps: 1.74 },
        { year: 2024, eps: 11.93 },
      ],
    });
    expect(r.value).toBe(GROWTH_10Y_CAP);
  });

  it("EPS 전년대비 평균 detail — 구간·연도별·결과", () => {
    const r = deriveValueInvestGrowth10y({
      eps: null,
      forwardEps: null,
      revenueGrowth: null,
      epsHistory: [
        { year: 2023, eps: 10 },
        { year: 2024, eps: 12 },
      ],
    });
    expect(r.detail?.method).toBe("eps_avg_yoy");
    expect(r.detail?.lines.join("\n")).toMatch(/2023→2024/);
    expect(r.detail?.lines.join("\n")).toMatch(/적용: 20\.0%/);
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
    expect(w.start.year).toBe(2014);
    expect(w.end.year).toBe(2024);
    expect(w.periodYears).toBe(10);
    expect(w.fromListing).toBe(false);
  });

  it("상장 10년 미만 — 첫 실적연도부터", () => {
    const series = [
      { year: 2021, eps: 100 },
      { year: 2022, eps: 120 },
      { year: 2023, eps: 140 },
      { year: 2024, eps: 160 },
    ];
    const w = epsGrowthWindow(series);
    expect(w).not.toBeNull();
    if (!w) return;
    expect(w.start.year).toBe(2021);
    expect(w.end.year).toBe(2024);
    expect(w.periodYears).toBe(3);
    expect(w.fromListing).toBe(true);
    const r = epsAvgYoyGrowthFromHistory(series);
    expect(r).toBeCloseTo(avgYoy(series), 4);
  });
});
