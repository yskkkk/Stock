import { describe, expect, it } from "vitest";
import {
  exchangeToTradingViewPrefix,
  tradingViewChartUrl,
  yahooStockSymbolToTradingView,
} from "./tradingviewSymbols";

describe("tradingviewSymbols", () => {
  it("maps US tickers with exchange to the correct TV prefix", () => {
    expect(yahooStockSymbolToTradingView("TJX", "us", "NYSE")).toBe("NYSE:TJX");
    expect(yahooStockSymbolToTradingView("POOL", "us", "NASDAQ")).toBe(
      "NASDAQ:POOL",
    );
  });

  it("defaults US tickers without exchange to NASDAQ", () => {
    expect(yahooStockSymbolToTradingView("AAPL", "us")).toBe("NASDAQ:AAPL");
  });

  it("maps KR tickers to KRX TV symbols", () => {
    expect(yahooStockSymbolToTradingView("005930.KS", "kr")).toBe("KRX:005930");
  });

  it("parses exchange labels", () => {
    expect(exchangeToTradingViewPrefix("NYSE")).toBe("NYSE");
    expect(exchangeToTradingViewPrefix("NASDAQ Global Select")).toBe("NASDAQ");
    expect(exchangeToTradingViewPrefix("NYQ")).toBe("NYSE");
  });

  it("builds chart URL with daily interval", () => {
    const url = tradingViewChartUrl("NYSE:TJX");
    expect(url).toContain("https://www.tradingview.com/chart/?");
    expect(url).toContain("symbol=NYSE%3ATJX");
    expect(url).toContain("interval=D");
  });
});
