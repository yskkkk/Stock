import { describe, expect, it } from "vitest";
import {
  assertKrLiveBuyAutoSellInterlock,
  KR_LIVE_AUTO_SELL_SUPPORTED,
} from "./toss-trading-adapter.js";

describe("toss KR auto-sell interlock", () => {
  it("blocks armed KR buy while auto-sell unsupported", () => {
    expect(KR_LIVE_AUTO_SELL_SUPPORTED).toBe(false);
    const hit = assertKrLiveBuyAutoSellInterlock({
      id: "p1",
      name: "KR prog",
      status: "armed",
      armedMarkets: { kr: true, crypto: false },
      autoSellAtTarget: true,
    });
    expect(hit?.code).toBe("KR_AUTO_SELL_INTERLOCK");
  });

  it("allows when KR not armed", () => {
    expect(
      assertKrLiveBuyAutoSellInterlock({
        status: "armed",
        armedMarkets: { kr: false, crypto: true },
      }),
    ).toBeNull();
  });

  it("blocks when auto sell disabled", () => {
    const hit = assertKrLiveBuyAutoSellInterlock({
      status: "armed",
      armedMarkets: { kr: true, crypto: false },
      autoSellAtTarget: false,
    });
    expect(hit?.code).toBe("KR_AUTO_SELL_INTERLOCK");
    expect(hit?.message).toContain("자동 매도");
  });
});
