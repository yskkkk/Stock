import { describe, expect, it } from "vitest";
import {
  evaluateLiveTradeSellDecision,
  normalizeSellHorizon,
  resolveProgramSellHorizon,
} from "./live-trade-sell-strategy.js";

function candle(close, extra = {}) {
  return {
    open: close * 0.999,
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume: extra.volume ?? 1000,
    time: extra.time ?? Math.floor(Date.now() / 1000),
    ...extra,
  };
}

function risingCloses(n, start = 100, step = 0.2) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(candle(start + i * step, { time: 1_700_000_000 + i * 300 }));
  }
  return out;
}

describe("live-trade-sell-strategy", () => {
  it("defaults armed program to short horizon", () => {
    expect(resolveProgramSellHorizon({ status: "armed" })).toBe("short");
    expect(normalizeSellHorizon(undefined)).toBe("short");
    expect(normalizeSellHorizon("medium")).toBe("medium");
  });

  it("sells at target price with reason tag", () => {
    const hit = evaluateLiveTradeSellDecision(
      {
        avgEntryPrice: 100,
        targetSellPrice: 110,
        stopLossPrice: 95,
        boughtAtMs: Date.now() - 60_000,
      },
      { sellHorizon: "short" },
      110,
      [],
    );
    expect(hit?.note).toContain("[단기]");
    expect(hit?.note).toContain("목표가");
  });

  it("short RSI exhaustion after overbought", () => {
    const closes = risingCloses(40, 100, 0.5);
    for (let i = 34; i < 40; i++) {
      closes[i] = candle(120 - (i - 34) * 0.4, {
        time: 1_700_000_000 + i * 300,
        volume: 2000,
      });
    }
    const hit = evaluateLiveTradeSellDecision(
      {
        avgEntryPrice: 100,
        targetSellPrice: 200,
        stopLossPrice: 90,
        boughtAtMs: Date.now() - 30 * 60_000,
      },
      { sellHorizon: "short" },
      closes.at(-1).close,
      closes,
    );
    expect(hit?.signal).toBe("rsi_exhaustion");
    expect(hit?.note).toContain("RSI");
  });

  it("short time stop after 36h with weak profit", () => {
    const hit = evaluateLiveTradeSellDecision(
      {
        avgEntryPrice: 100,
        targetSellPrice: 130,
        stopLossPrice: 90,
        boughtAtMs: Date.now() - 37 * 3_600_000,
      },
      { sellHorizon: "short" },
      100.3,
      risingCloses(35, 100, 0.01),
    );
    expect(hit?.signal).toBe("time_stop");
    expect(hit?.note).toContain("단기 보유");
  });
});
