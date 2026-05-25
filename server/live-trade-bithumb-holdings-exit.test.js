import { describe, expect, it, vi } from "vitest";
import { getLastBuyExitTargetsSync } from "./live-trade-portfolio-store.js";

describe("bithumb holdings exit targets", () => {
  it("reads last buy target/stop from store trades", () => {
    const store = {
      trades: [
        {
          id: "1",
          programId: "p1",
          side: "buy",
          symbol: "XRP-USDT",
          market: "crypto",
          quantity: 1,
          price: 2000,
          amount: 2000,
          atMs: 100,
          targetSellPrice: 2351,
          stopLossPrice: 1989,
          buySignalIds: [],
        },
        {
          id: "2",
          programId: "p1",
          side: "buy",
          symbol: "XRP-USDT",
          market: "crypto",
          quantity: 1,
          price: 2100,
          amount: 2100,
          atMs: 200,
          targetSellPrice: 2400,
          stopLossPrice: 1950,
          buySignalIds: ["rsi"],
        },
      ],
    };
    const meta = getLastBuyExitTargetsSync("p1", "crypto", "XRP-USDT", store);
    expect(meta?.targetSellPrice).toBe(2400);
    expect(meta?.stopLossPrice).toBe(1950);
  });
});
