import { describe, expect, it } from "vitest";
import { tossRoundTripForHolding } from "./tossHoldingFeeRates";

describe("tossRoundTripForHolding", () => {
  it("uses market-specific API fee when available", () => {
    expect(
      tossRoundTripForHolding("kr", { kr: 0.0026, us: 0.005, source: "api" }),
    ).toBe(0.0026);
    expect(
      tossRoundTripForHolding("us", { kr: 0.0026, us: 0.005, source: "api" }),
    ).toBe(0.005);
  });

  it("falls back to default when API fees missing", () => {
    expect(tossRoundTripForHolding("kr", { source: "default" })).toBe(0.002);
  });
});
