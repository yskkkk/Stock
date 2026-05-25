import { describe, expect, it } from "vitest";
import {
  evaluateLiveTradeSellDecision,
  normalizeSellHorizon,
  resolveProgramSellHorizon,
  resolveShortTrailingStep,
  SHORT_MIN_TECH_EXIT_NET_PCT,
  computeShortTermTechnicalStopLoss,
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
    expect(SHORT_MIN_TECH_EXIT_NET_PCT).toBe(1);
  });

  it("blocks RSI technical exit below min net profit", () => {
    const closes = risingCloses(40, 100, 0.05);
    for (let i = 34; i < 40; i++) {
      closes[i] = candle(100.4 - (i - 34) * 0.02, {
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
    expect(hit?.signal).not.toBe("rsi_exhaustion");
  });

  it("step trailing take at high net profit", () => {
    const boughtAt = Date.now() - 2 * 3_600_000;
    const closes = [];
    for (let i = 0; i < 33; i++) {
      closes.push(
        candle(108, {
          high: 108.5,
          low: 107.5,
          time: Math.floor((boughtAt + i * 300_000) / 1000),
          volume: 1000,
        }),
      );
    }
    closes.push(
      candle(118, {
        high: 120,
        low: 117,
        time: Math.floor((boughtAt + 33 * 300_000) / 1000),
        volume: 1000,
      }),
    );
    closes.push(
      candle(116, {
        high: 116.5,
        low: 115.5,
        time: Math.floor((boughtAt + 34 * 300_000) / 1000),
        volume: 1000,
      }),
    );
    const hit = evaluateLiveTradeSellDecision(
      {
        avgEntryPrice: 100,
        targetSellPrice: 200,
        stopLossPrice: 80,
        boughtAtMs: boughtAt,
      },
      { sellHorizon: "short" },
      116,
      closes,
    );
    expect(hit?.signal).toBe("trailing_take");
    expect(hit?.note).toContain("트레일링");
    expect(resolveShortTrailingStep(11)?.dropFromHighPct).toBe(3);
  });

  it("computes technical stop from swing low", () => {
    const candles = risingCloses(30, 100, 0.3);
    for (let i = 20; i < 30; i++) {
      candles[i] = candle(100, { low: 95, high: 101, time: 1_700_000_000 + i * 300 });
    }
    const stop = computeShortTermTechnicalStopLoss(
      { avgEntryPrice: 100, stopLossPrice: null },
      candles,
    );
    expect(stop).not.toBeNull();
    expect(stop).toBeLessThan(100);
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
