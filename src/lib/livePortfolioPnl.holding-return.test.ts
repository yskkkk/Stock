import { describe, expect, it } from "vitest";
import {
  holdingGrossReturnPctFromCost,
  holdingNetReturnPctFromCost,
} from "./livePortfolioPnl";

describe("holding return from cost basis", () => {
  it("is negative when net valuation is below purchase", () => {
    const gross = holdingGrossReturnPctFromCost(20_000, 19_998);
    const net = holdingNetReturnPctFromCost(20_000, 19_998, 0.002);
    expect(gross).not.toBeNull();
    expect(gross!).toBeLessThan(0);
    expect(net).not.toBeNull();
    expect(net!).toBeLessThan(0);
  });

  it("does not mirror 24h quote change when cost differs", () => {
    const dailyUp = 2.25;
    const fromCost = holdingGrossReturnPctFromCost(20_000, 19_900);
    expect(fromCost).not.toBeCloseTo(dailyUp, 1);
    expect(fromCost!).toBeLessThan(-0.4);
  });
});
