import { describe, expect, it } from "vitest";
import {
  formatMaApproachLabel,
  maProximityPriceClass,
  trendBadgeClass,
} from "./stockVaultChartInsights";

describe("stockVaultChartInsights", () => {
  it("maps trend to class", () => {
    expect(trendBadgeClass("up")).toContain("--up");
    expect(trendBadgeClass("down")).toContain("--down");
  });

  it("picks closest MA for price tint", () => {
    expect(
      maProximityPriceClass([
        { period: 60, ma: 100, diffPct: 1.2, side: "above", approach: "from_above" },
        { period: 20, ma: 101, diffPct: 0.3, side: "below", approach: "from_below" },
      ]),
    ).toBe("stock-vault-tab__price--wk-ma-20");
  });

  it("formats approach labels", () => {
    expect(
      formatMaApproachLabel("from_below", {
        fromBelow: "하단접근",
        fromAbove: "상단접근",
        flat: "정체",
      }),
    ).toBe("하단접근");
  });
});
