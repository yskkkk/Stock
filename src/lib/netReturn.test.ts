import { describe, expect, it } from "vitest";
import {
  netReturnPct,
  netReturnPctFromPrices,
  outcomeFromPricesWithFees,
} from "./netReturn";

describe("netReturn", () => {
  it("subtracts round-trip fee from gross return", () => {
    expect(netReturnPct(100, 101)).toBeCloseTo(0.798, 2);
    expect(netReturnPct(100, 100)).toBeCloseTo(-0.2, 2);
  });

  it("classifies win/loss after fees", () => {
    expect(outcomeFromPricesWithFees(100, 100.2)).toBe("flat");
    expect(outcomeFromPricesWithFees(100, 101)).toBe("win");
    expect(outcomeFromPricesWithFees(100, 99)).toBe("loss");
  });

  it("returns null for invalid prices", () => {
    expect(netReturnPctFromPrices(null, 100)).toBeNull();
    expect(netReturnPctFromPrices(0, 100)).toBeNull();
  });
});
