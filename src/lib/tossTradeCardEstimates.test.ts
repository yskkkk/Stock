import { describe, expect, it } from "vitest";
import {
  estimateSaleTaxAmount,
  estimateSellFeeAmount,
  KR_LISTED_SALE_TAX_RATE,
} from "./tossTradeCardEstimates";
import { holdingNetUnrealizedPnl } from "./livePortfolioPnl";

describe("tossTradeCardEstimates", () => {
  it("estimates KR sale tax near Toss ratio", () => {
    const tax = estimateSaleTaxAmount(2_534_920, "kr");
    expect(tax).toBe(Math.round(2_534_920 * KR_LISTED_SALE_TAX_RATE));
    expect(tax).toBe(5_070);
  });

  it("estimates sell fee from round-trip rate", () => {
    expect(estimateSellFeeAmount(2_534_920, 0)).toBe(0);
    expect(estimateSellFeeAmount(1_000_000, 0.002)).toBe(1_000);
  });
});

describe("holdingNetUnrealizedPnl", () => {
  it("subtracts sell fee from market value before pnl", () => {
    const pnl = holdingNetUnrealizedPnl(
      { costBasis: 2_488_000, marketValue: 2_534_920 },
      0,
    );
    expect(pnl).toBe(46_920);
  });
});
