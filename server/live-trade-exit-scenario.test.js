import { describe, expect, it } from "vitest";
import {
  computeShortTermExitScenario,
  computeSwingExitScenarioFromDailyCandles,
  SHORT_EXIT_LIMITS,
  SWING_EXIT_LIMITS,
} from "./live-trade-exit-scenario.js";

function candle(close, high = close * 1.002, low = close * 0.998, vol = 1000) {
  return { open: close, high, low, close, volume: vol };
}

function series(start, step, n, vol = 1000) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    out.push(candle(p, p * 1.003, p * 0.997, vol));
    p += step;
  }
  return out;
}

describe("live-trade-exit-scenario", () => {
  it("short term caps take-profit within day-trade range", () => {
    const entry = 10_000;
    const daily = series(entry * 0.98, entry * 0.002, 40);
    const intra = series(entry, 8, 48);
    const out = computeShortTermExitScenario({
      dailyCandles: daily,
      intradayCandles: intra,
      entryPrice: entry,
      market: "kr",
    });
    expect(out.targetSellPrice).toBeGreaterThan(entry);
    expect(out.takeProfitNetPct).toBeLessThanOrEqual(SHORT_EXIT_LIMITS.maxTpNetPctKr);
    expect(out.takeProfitNetPct).toBeGreaterThanOrEqual(SHORT_EXIT_LIMITS.minTpNetPct);
    expect(out.exitScenarioNote).toMatch(/단타/);
  });

  it("swing medium avoids very high targets vs long", () => {
    const entry = 50_000;
    const candles = series(entry * 0.85, entry * 0.004, 80);
    for (let i = 60; i < candles.length; i++) {
      candles[i] = candle(entry * 1.25, entry * 1.26, entry * 1.22);
    }
    const medium = computeSwingExitScenarioFromDailyCandles(
      candles,
      entry,
      "kr",
      { sellHorizon: "medium" },
    );
    const long = computeSwingExitScenarioFromDailyCandles(
      candles,
      entry,
      "kr",
      { sellHorizon: "long" },
    );
    expect(medium.takeProfitNetPct).toBeLessThanOrEqual(
      SWING_EXIT_LIMITS.maxTpNetPctMedium,
    );
    expect(long.takeProfitNetPct).toBeLessThanOrEqual(
      SWING_EXIT_LIMITS.maxTpNetPctLong,
    );
    expect(medium.exitScenarioNote).toMatch(/스윙/);
  });
});
