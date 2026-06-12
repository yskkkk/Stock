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

  it("maps Yahoo class shares to TradingView dot tickers", () => {
    expect(yahooStockSymbolToTradingView("BRK-B", "us", "NYSE")).toBe(
      "NYSE:BRK.B",
    );
    expect(yahooStockSymbolToTradingView("BRK-A", "us", "NYSE")).toBe(
      "NYSE:BRK.A",
    );
    expect(yahooStockSymbolToTradingView("BF-B", "us", "NYSE")).toBe(
      "NYSE:BF.B",
    );
  });

  it("builds chart URL with daily interval", () => {
    const url = tradingViewChartUrl("NYSE:BRK.B");
    expect(url).toContain("https://www.tradingview.com/chart/?");
    expect(url).toContain("symbol=NYSE%3ABRK.B");
    expect(url).toContain("interval=D");
  });
});
