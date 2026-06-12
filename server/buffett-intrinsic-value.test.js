import { describe, it, expect } from "vitest";
import {
  calcSimpleFairPrice,
  calcExplicitPhasePv,
  calcTerminalPv,
  calcFullIntrinsic,
  calcEpsVolatility,
  calcImpliedYield,
  calcMarginOfSafetyPrice,
} from "./buffett-intrinsic-value.js";

describe("calcSimpleFairPrice", () => {
  it("EPS / 할인율", () => {
    expect(calcSimpleFairPrice(2.5, 0.06)).toBeCloseTo(2.5 / 0.06, 4);
  });
  it("EPS 0 이하면 null", () => {
    expect(calcSimpleFairPrice(0, 0.06)).toBeNull();
    expect(calcSimpleFairPrice(-1, 0.06)).toBeNull();
  });
  it("할인율 0 이하면 null", () => {
    expect(calcSimpleFairPrice(5, 0)).toBeNull();
    expect(calcSimpleFairPrice(5, -0.01)).toBeNull();
  });
});

describe("calcExplicitPhasePv", () => {
  it("table 9-3 uniform 10k ×5 at 15%", () => {
    const r = calcExplicitPhasePv(10_000, 0, 5, 0.15);
    expect(r).not.toBeNull();
    expect(Math.abs((r?.totalPv ?? 0) - 33_522)).toBeLessThan(2);
  });
  it("성장률 12%, 10년 — epsAtEnd = eps0 × 1.12^10", () => {
    const r = calcExplicitPhasePv(2.5, 0.12, 10, 0.1);
    expect(r).not.toBeNull();
    expect(Math.abs((r?.epsAtEnd ?? 0) - 2.5 * 1.12 ** 10)).toBeLessThan(0.15);
  });
  it("years 클램프: 0 → 1로 처리", () => {
    const r = calcExplicitPhasePv(10, 0.1, 0, 0.1);
    expect(r?.yearly.length).toBe(1);
  });
  it("years 클램프: 50 → 30으로 처리", () => {
    const r = calcExplicitPhasePv(10, 0.1, 50, 0.1);
    expect(r?.yearly.length).toBe(30);
  });
  it("EPS 0 이하면 null", () => {
    expect(calcExplicitPhasePv(-1, 0.1, 10, 0.1)).toBeNull();
  });
});

describe("calcTerminalPv", () => {
  it("gap ≤ 0.005면 null (할인율 ≈ 성장률)", () => {
    expect(calcTerminalPv(5, 0.095, 10, 0.1)).toBeNull();
  });
  it("정상 계산 — terminal > 0", () => {
    const r = calcTerminalPv(5, 0.03, 10, 0.1);
    expect(r).not.toBeNull();
    expect((r?.terminal ?? 0)).toBeGreaterThan(0);
    expect((r?.pv ?? 0)).toBeGreaterThan(0);
  });
  it("gap < 0.03이면 gapWarning = true", () => {
    const r = calcTerminalPv(5, 0.08, 10, 0.1);
    expect(r?.gapWarning).toBe(true);
  });
  it("gap >= 0.03이면 gapWarning = false", () => {
    const r = calcTerminalPv(5, 0.03, 10, 0.1);
    expect(r?.gapWarning).toBe(false);
  });
});

describe("calcFullIntrinsic", () => {
  it("table 9-4 McDonald's style — 84.51 ± 4", () => {
    const r = calcFullIntrinsic({
      eps0: 2.5,
      growth10y: 0.12,
      growthTerminal: 0.05,
      years: 10,
      discountRate: 0.1,
      debtPerShare: 6,
    });
    expect(r?.intrinsicPerShare).not.toBeNull();
    expect(Math.abs((r?.intrinsicPerShare ?? 0) - 84.51)).toBeLessThan(4);
  });
  it("부채 차감 시 내재가치 감소", () => {
    const noDebt = calcFullIntrinsic({ eps0: 5, growth10y: 0.1, growthTerminal: 0.03, years: 10, discountRate: 0.08 });
    const withDebt = calcFullIntrinsic({ eps0: 5, growth10y: 0.1, growthTerminal: 0.03, years: 10, discountRate: 0.08, debtPerShare: 10 });
    expect((noDebt?.intrinsicPerShare ?? 0)).toBeGreaterThan((withDebt?.intrinsicPerShare ?? 0));
  });
  it("growthTerminal 없으면 terminalPv null", () => {
    const r = calcFullIntrinsic({ eps0: 5, growth10y: 0.1, years: 10, discountRate: 0.08 });
    expect(r?.terminalPv).toBeNull();
  });
  it("intrinsicPerShare ≤ 0 이면 null 반환", () => {
    const r = calcFullIntrinsic({ eps0: 5, growth10y: 0.1, years: 10, discountRate: 0.08, debtPerShare: 99999 });
    expect(r?.intrinsicPerShare).toBeNull();
  });
});

describe("calcEpsVolatility (표본표준편차)", () => {
  it("3개 미만이면 null", () => {
    expect(calcEpsVolatility([5, 10])).toBeNull();
    expect(calcEpsVolatility([5])).toBeNull();
  });
  it("모두 같은 값이면 CV = 0", () => {
    expect(calcEpsVolatility([10, 10, 10])).toBe(0);
  });
  it("표본분산 사용 — (n-1) 분모", () => {
    // [4, 6] 표본분산: ((4-5)^2 + (6-5)^2) / (2-1) = 2, 표준편차 = √2
    // 하지만 3개 이상 필요하므로 [4, 5, 6] 사용
    // 표본분산: ((4-5)^2 + (5-5)^2 + (6-5)^2) / (3-1) = 2/2 = 1, 표준편차 = 1
    // 평균 = 5, CV = 1/5 = 0.2
    const cv = calcEpsVolatility([4, 5, 6]);
    expect(cv).not.toBeNull();
    expect(Math.abs((cv ?? 0) - 0.2)).toBeLessThan(0.0001);
  });
  it("음수·0 EPS 제외 후 3개 미만이면 null", () => {
    expect(calcEpsVolatility([-1, 0, 5])).toBeNull();
  });
});

describe("calcImpliedYield", () => {
  it("EPS / 주가", () => {
    expect(calcImpliedYield(5, 100)).toBeCloseTo(0.05, 4);
  });
  it("주가 0이면 null", () => {
    expect(calcImpliedYield(5, 0)).toBeNull();
  });
  it("EPS 0 이하면 null", () => {
    expect(calcImpliedYield(0, 100)).toBeNull();
    expect(calcImpliedYield(-1, 100)).toBeNull();
  });
});

describe("calcMarginOfSafetyPrice", () => {
  it("25% 안전마진 — 내재가치 × 0.75", () => {
    expect(calcMarginOfSafetyPrice(100, 0.25)).toBeCloseTo(75, 4);
  });
  it("margin 클램프 0~0.5", () => {
    expect(calcMarginOfSafetyPrice(100, -0.1)).toBeCloseTo(100, 4);
    expect(calcMarginOfSafetyPrice(100, 0.9)).toBeCloseTo(50, 4);
  });
  it("내재가치 0 이하면 null", () => {
    expect(calcMarginOfSafetyPrice(0, 0.25)).toBeNull();
    expect(calcMarginOfSafetyPrice(-10, 0.25)).toBeNull();
  });
});
