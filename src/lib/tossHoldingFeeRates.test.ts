import { describe, expect, it } from "vitest";
import { tossRoundTripForHolding } from "./tossHoldingFeeRates";

describe("tossRoundTripForHolding", () => {
  it("always uses fixed 0.2% round-trip regardless of API rates", () => {
    expect(
      tossRoundTripForHolding("kr", { kr: 0.0026, us: 0.005, source: "api" }),
    ).toBe(0.002);
    expect(
      tossRoundTripForHolding("us", { kr: 0.0026, us: 0.005, source: "api" }),
    ).toBe(0.002);
    expect(tossRoundTripForHolding("kr", { source: "default" })).toBe(0.002);
    expect(tossRoundTripForHolding("kr", null)).toBe(0.002);
  });
});
