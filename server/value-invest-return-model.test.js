import { describe, it, expect } from "vitest";
import { calcValueInvestReturn, round2 } from "./value-invest-return-model.js";

describe("calcValueInvestReturn — 사진 검증", () => {
  it("$120 / EPS $3.33 / 성장 15.2% / PER 17.7 / 배당 25% / 목표 15% / 10년", () => {
    const r = calcValueInvestReturn({
      currentPrice: 120,
      currentEps: 3.33,
      growthRate: 0.152,
      averagePer: 17.7,
      payoutRatio: 0.25,
      targetReturnRate: 0.15,
      years: 10,
    });
    expect(r).not.toBeNull();
    expect(r?.yearlyEps.length).toBe(10);
    expect(Math.abs((r?.totalEps ?? 0) - 78.66)).toBeLessThan(0.05);
    expect(Math.abs((r?.futurePrice ?? 0) - 242.67)).toBeLessThan(0.05);
    expect(Math.abs((r?.totalDividends ?? 0) - 19.67)).toBeLessThan(0.05);
    expect(Math.abs((r?.totalReturn ?? 0) - 262.34)).toBeLessThan(0.05);
    expect(Math.abs((r?.cagrPct ?? 0) - 8)).toBeLessThan(0.15);
    expect(Math.abs((r?.fairBuyPrice ?? 0) - 64.85)).toBeLessThan(0.05);
  });
});

describe("calcValueInvestReturn — 입력 검증", () => {
  it("currentPrice 0 이하면 null", () => {
    expect(calcValueInvestReturn({ currentPrice: 0, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 })).toBeNull();
  });
  it("currentEps 0 이하면 null", () => {
    expect(calcValueInvestReturn({ currentPrice: 100, currentEps: 0, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 })).toBeNull();
  });
  it("averagePer 0 이하면 null", () => {
    expect(calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 0, payoutRatio: 0, targetReturnRate: 0.15 })).toBeNull();
  });
  it("targetReturnRate 0은 허용 (0% 목표수익률)", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0 });
    expect(r).not.toBeNull();
  });
});

describe("calcValueInvestReturn — 계산 로직", () => {
  it("배당 0이면 totalDividends = 0", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 });
    expect(r?.totalDividends).toBe(0);
  });
  it("성장률 0이면 epsAtEnd = currentEps", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 });
    expect(r?.epsAtEnd).toBe(5);
  });
  it("futurePrice = epsAtEnd × averagePer", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 20, payoutRatio: 0, targetReturnRate: 0.15 });
    expect(r?.futurePrice).toBeCloseTo((r?.epsAtEnd ?? 0) * 20, 1);
  });
  it("years=5 — yearlyEps 5개", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15, years: 5 });
    expect(r?.yearlyEps.length).toBe(5);
  });
  it("totalReturn = futurePrice + totalDividends", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0.3, targetReturnRate: 0.15 });
    const expected = round2((r?.futurePrice ?? 0) + (r?.totalDividends ?? 0));
    expect(r?.totalReturn).toBeCloseTo(expected ?? 0, 1);
  });
  it("cagr — (totalReturn/currentPrice)^(1/n) - 1", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 });
    const expected = ((r?.totalReturn ?? 0) / 100) ** (1 / 10) - 1;
    // cagr는 round2로 소수 2자리 반올림 저장됨 → 정밀도 2 (±0.005) 허용
    expect(r?.cagr).toBeCloseTo(expected, 2);
  });
  it("fairBuyPrice = totalReturn / (1+target)^n", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 });
    const expected = (r?.totalReturn ?? 0) / (1.15 ** 10);
    expect(r?.fairBuyPrice).toBeCloseTo(expected, 1);
  });
  it("음수 성장률 허용 — epsAtEnd < currentEps", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 10, growthRate: -0.05, averagePer: 15, payoutRatio: 0, targetReturnRate: 0.15 });
    expect(r).not.toBeNull();
    expect((r?.epsAtEnd ?? 0)).toBeLessThan(10);
  });
  it("배당 성향 100%이면 총배당 = totalEps", () => {
    const r = calcValueInvestReturn({ currentPrice: 100, currentEps: 5, growthRate: 0.1, averagePer: 15, payoutRatio: 1, targetReturnRate: 0.15 });
    expect(r?.totalDividends).toBeCloseTo(r?.totalEps ?? 0, 1);
  });
  it("high growth — fairBuyPrice > currentPrice 가능", () => {
    const r = calcValueInvestReturn({ currentPrice: 50, currentEps: 5, growthRate: 0.25, averagePer: 20, payoutRatio: 0, targetReturnRate: 0.15 });
    expect((r?.fairBuyPrice ?? 0)).toBeGreaterThan(50);
  });
});

describe("round2", () => {
  it("소수점 2자리 반올림", () => {
    // 1.005 * 100 = 100.499... (부동소수점) → 명확한 값으로 대체
    expect(round2(1.226)).toBe(1.23);  // 1.226 * 100 = 122.6... → 123 → 1.23
    expect(round2(1.004)).toBe(1);
  });
  it("NaN이면 null", () => {
    expect(round2(NaN)).toBeNull();
    expect(round2(Infinity)).toBeNull();
  });
});
