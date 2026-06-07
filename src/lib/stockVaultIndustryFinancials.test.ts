import { describe, expect, it } from "vitest";
import {
  formatVaultIndustryFinancialLines,
  vaultIndustryFinVerdictClassName,
} from "./stockVaultIndustryFinancials";

describe("vaultIndustryFinVerdictClassName", () => {
  it("maps verdict to badge class", () => {
    expect(vaultIndustryFinVerdictClassName("better")).toContain("better");
    expect(vaultIndustryFinVerdictClassName("worse")).toContain("worse");
  });
});

describe("formatVaultIndustryFinancialLines", () => {
  it("formats metric line and peer count", () => {
    const out = formatVaultIndustryFinancialLines(
      {
        per: 12.5,
        roe: 0.18,
        profitMargin: 0.09,
        industryPeerCount: 8,
      },
      {
        per: "PER",
        roe: "ROE",
        profitMargin: "이익률",
        peerCount: (n) => `동종 ${n}종목`,
      },
    );
    expect(out.metricLine).toContain("PER 12.50");
    expect(out.peerLine).toBe("동종 8종목");
  });
});
