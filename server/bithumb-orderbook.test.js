import { describe, expect, it } from "vitest";
import {
  collectBidLevelsFromOrderbookUnits,
  estimateMarketSellAvgFillPrice,
  sellSlippagePctFromBestBid,
} from "./bithumb-orderbook.js";

describe("bithumb-orderbook", () => {
  it("estimates avg fill walking bid depth", () => {
    const units = [
      { bid_price: "100", bid_size: "1" },
      { bid_price: "99", bid_size: "2" },
      { bid_price: "98", bid_size: "5" },
    ];
    const levels = collectBidLevelsFromOrderbookUnits(units);
    const est = estimateMarketSellAvgFillPrice(levels, 2.5);
    expect(est.ok).toBe(true);
    expect(est.bestBid).toBe(100);
    expect(est.avgPrice).toBeCloseTo((100 * 1 + 99 * 1.5) / 2.5, 6);
  });

  it("flags insufficient depth", () => {
    const levels = collectBidLevelsFromOrderbookUnits([
      { bid_price: "50", bid_size: "0.1" },
    ]);
    const est = estimateMarketSellAvgFillPrice(levels, 10);
    expect(est.ok).toBe(false);
    expect(est.reason).toBe("insufficient_depth");
  });

  it("computes slippage from best bid", () => {
    expect(sellSlippagePctFromBestBid(100, 98)).toBeCloseTo(2, 5);
    expect(sellSlippagePctFromBestBid(100, 99)).toBeCloseTo(1, 5);
  });
});
