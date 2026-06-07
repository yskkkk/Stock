import { describe, expect, it } from "vitest";
import {
  tradingViewChartUrl,
  yahooStockSymbolToTradingView,
} from "./tradingviewSymbols";

describe("tradingviewSymbols", () => {
  it("maps US tickers to NASDAQ TV symbols", () => {
    expect(yahooStockSymbolToTradingView("ES", "us")).toBe("NASDAQ:ES");
  });

  it("maps KR tickers to KRX TV symbols", () => {
    expect(yahooStockSymbolToTradingView("005930.KS", "kr")).toBe("KRX:005930");
  });

  it("builds chart URL with daily interval", () => {
    const url = tradingViewChartUrl("NASDAQ:ES");
    expect(url).toContain("https://www.tradingview.com/chart/?");
    expect(url).toContain("symbol=NASDAQ%3AES");
    expect(url).toContain("interval=D");
  });
});
