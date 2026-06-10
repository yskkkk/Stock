import { describe, expect, it } from "vitest";
import {
  weeklyMaProximityBadgeClass,
  weeklyMaProximityPriceClass,
} from "./stockVaultWeeklyMaProximity";

describe("stockVaultWeeklyMaProximity", () => {
  it("maps period to badge class", () => {
    expect(weeklyMaProximityBadgeClass(20)).toContain("--20");
    expect(weeklyMaProximityBadgeClass(60)).toContain("--60");
    expect(weeklyMaProximityBadgeClass(120)).toContain("--120");
  });

  it("picks closest hit for price tint", () => {
    expect(
      weeklyMaProximityPriceClass([
        { period: 60, ma: 100, diffPct: 1.5, side: "above" },
        { period: 20, ma: 101, diffPct: 0.4, side: "below" },
      ]),
    ).toBe("stock-vault-tab__price--wk-ma-20");
  });
});
