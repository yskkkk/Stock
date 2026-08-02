import { describe, expect, it } from "vitest";
import { computeExpectedReturnCalc } from "./expectedReturnCalc";

/** 표 12-1 휴렛팩커드 예상 투자 수익률 (책 예시) */
describe("computeExpectedReturnCalc", () => {
  it("matches Hewlett-Packard table 12-1", () => {
    const r = computeExpectedReturnCalc({
      currentPrice: 120,
      currentEps: 3.33,
      earningsGrowthPct: 15.2,
      avgPer: 17.7,
      dividendPayoutPct: 25,
      years: 10,
      targetReturnPct: 15,
    });
    expect(r).not.toBeNull();
    expect(r!.years[0]!.eps).toBeCloseTo(3.84, 1);
    expect(r!.years[9]!.eps).toBeCloseTo(13.71, 1);
    expect(r!.totalEps).toBeCloseTo(78.66, 1);
    expect(r!.futurePrice).toBeCloseTo(242.67, 1);
    expect(r!.totalDividends).toBeCloseTo(19.66, 1);
    expect(r!.totalProceeds).toBeCloseTo(262.33, 1);
    expect(r!.expectedCagr! * 100).toBeCloseTo(8.13, 1);
    expect(r!.maxBuyPrice).toBeCloseTo(64.83, 1);
  });

  it("rejects invalid inputs", () => {
    expect(
      computeExpectedReturnCalc({
        currentPrice: 0,
        currentEps: 3,
        earningsGrowthPct: 10,
        avgPer: 15,
        dividendPayoutPct: 20,
        years: 10,
        targetReturnPct: 15,
      }),
    ).toBeNull();
  });
});
