import { describe, expect, it } from "vitest";
import {
  aggregateBigGainSignals,
  countBigGainStocks,
  isBigGainItem,
} from "./recTrackerBigGainSignals";
import type { RecommendationTrackerItem } from "../types";

function item(
  partial: Partial<RecommendationTrackerItem> & Pick<RecommendationTrackerItem, "symbol" | "changePct" | "signalIds">,
): RecommendationTrackerItem {
  return {
    id: "1",
    date: "2026-05-01",
    market: "kr",
    name: "Test",
    currency: "KRW",
    entryPrice: 100,
    recordedAtMs: null,
    score: 10,
    currentPrice: 110,
    outcome: "win",
    telegramNotified: true,
    ...partial,
  };
}

describe("recTrackerBigGainSignals", () => {
  it("detects big gain by net change pct", () => {
    expect(isBigGainItem(item({ symbol: "A", changePct: 5.1, signalIds: [] }))).toBe(true);
    expect(isBigGainItem(item({ symbol: "B", changePct: 5, signalIds: [] }))).toBe(false);
  });

  it("aggregates signals on big gain stocks only", () => {
    const stats = aggregateBigGainSignals([
      item({ symbol: "A", changePct: 8, signalIds: ["volume", "rsi"] }),
      item({ symbol: "B", changePct: 3, signalIds: ["volume"] }),
      item({ symbol: "C", changePct: 6, signalIds: ["volume"] }),
    ]);
    expect(stats.find((s) => s.signalId === "volume")?.hitCount).toBe(2);
    expect(stats.find((s) => s.signalId === "rsi")?.hitCount).toBe(1);
    expect(countBigGainStocks([
      item({ symbol: "A", changePct: 8, signalIds: [] }),
      item({ symbol: "A", changePct: 9, signalIds: [] }),
      item({ symbol: "B", changePct: 3, signalIds: [] }),
    ])).toBe(1);
  });
});
