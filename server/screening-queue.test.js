import { describe, expect, it, vi, afterEach } from "vitest";
import { buildScreeningQueue, scanScopeLabel } from "./screening-queue.js";
import * as marketHours from "./market-hours.js";

describe("screening-queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scanScopeLabel is always full scope text", () => {
    expect(scanScopeLabel()).toBe("국내 300 · S&P 500");
  });

  it("buildScreeningQueue skips KR when market closed", () => {
    vi.spyOn(marketHours, "isMarketOpenBySchedule").mockImplementation((m) => m !== "kr");
    vi.spyOn(marketHours, "isStockTradableBySchedule").mockImplementation((m) => m !== "kr");
    const { queue, includeKr, scanScopeKrActive, scanScopeUsActive, scanScopeLabel: label } =
      buildScreeningQueue({
      kr: [{ symbol: "005930.KS", name: "Samsung" }],
      us: [{ symbol: "AAPL", name: "Apple" }],
      crypto: [{ symbol: "BTC-KRW", name: "Bitcoin" }],
    });
    expect(includeKr).toBe(false);
    expect(scanScopeKrActive).toBe(false);
    expect(scanScopeUsActive).toBe(true);
    expect(label).toBe("국내 300 · S&P 500");
    expect(queue.map((q) => q.market)).toEqual(["us", "crypto"]);
  });

  it("buildScreeningQueue includes KR when market open", () => {
    vi.spyOn(marketHours, "isMarketOpenBySchedule").mockReturnValue(true);
    const { queue, includeKr } = buildScreeningQueue({
      kr: [{ symbol: "005930.KS" }],
      us: [{ symbol: "AAPL" }],
      crypto: [],
    });
    expect(includeKr).toBe(true);
    expect(queue.map((q) => q.market)).toEqual(["kr", "us"]);
  });
});
