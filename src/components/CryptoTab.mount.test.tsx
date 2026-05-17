import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartOverlays } from "./StockChart";
import CryptoTab from "./CryptoTab";

const overlaysSeen: ChartOverlays[] = [];

vi.mock("./StockChart", () => ({
  default: function MockStockChart(props: { overlays: ChartOverlays }) {
    overlaysSeen.push(props.overlays);
    return <div data-testid="mock-stock-chart" />;
  },
}));

vi.mock("../api", () => ({
  fetchCryptoUniverse: vi.fn(() =>
    Promise.resolve({
      assets: [
        { symbol: "BTC-USDT", name: "Bitcoin", quoteVolume: 1e9 },
        { symbol: "ETH-USDT", name: "Ethereum", quoteVolume: 1e8 },
      ],
    }),
  ),
  fetchCryptoQuotes: vi.fn(() =>
    Promise.resolve({
      quotes: {
        "BTC-USDT": {
          symbol: "BTC-USDT",
          name: "Bitcoin",
          price: 50_000,
          currency: "USDT",
          changePercent: 0.1,
        },
        "ETH-USDT": {
          symbol: "ETH-USDT",
          name: "Ethereum",
          price: 3000,
          currency: "USDT",
          changePercent: -0.2,
        },
      },
    }),
  ),
  fetchStock: vi.fn((_sym: string) =>
    Promise.resolve({
      quote: {
        symbol: "BTC-USDT",
        name: "Bitcoin",
        price: 50_000,
        currency: "USDT",
        changePercent: 0.1,
      },
      candles: [
        { time: 1704067200, open: 1, high: 2, low: 0.5, close: 1.5 },
        { time: 1704153600, open: 1.5, high: 2, low: 1, close: 1.8 },
      ],
      dailyCandles: [] as { time: number; open: number; high: number; low: number; close: number }[],
      interval: "1d",
      candleCount: 2,
    }),
  ),
}));

describe("CryptoTab", () => {
  beforeEach(() => {
    overlaysSeen.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses the same overlays object reference across list quote poll ticks", async () => {
    render(<CryptoTab />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await screen.findByTestId("mock-stock-chart");
    const refAfterChart = overlaysSeen[overlaysSeen.length - 1]!;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const refAfterPoll = overlaysSeen[overlaysSeen.length - 1]!;
    expect(refAfterPoll).toBe(refAfterChart);
  });
});
