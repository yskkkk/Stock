import { describe, expect, it } from "vitest";
import {
  parseKrCommaPrice,
  parseNaverDomesticRow,
  yahooSymbolToKrCode,
} from "./kr-naver-quote.js";

describe("kr-naver-quote", () => {
  it("yahooSymbolToKrCode", () => {
    expect(yahooSymbolToKrCode("005930.KS")).toBe("005930");
    expect(yahooSymbolToKrCode("005930")).toBe("005930");
    expect(yahooSymbolToKrCode("AAPL")).toBe(null);
  });

  it("parseKrCommaPrice", () => {
    expect(parseKrCommaPrice("292,500")).toBe(292500);
    expect(parseKrCommaPrice("")).toBe(null);
  });

  it("prefers over-market when newer than regular", () => {
    const row = {
      itemCode: "005930",
      stockName: "삼성전자",
      closePrice: "292,500",
      localTradedAt: "2026-05-22T15:30:00+09:00",
      fluctuationsRatio: "-2.34",
      marketStatus: "CLOSE",
      overMarketPriceInfo: {
        overPrice: "293,000",
        localTradedAt: "2026-05-22T20:00:00.000000+09:00",
        fluctuationsRatio: "-2.17",
      },
    };
    const q = parseNaverDomesticRow(row);
    expect(q?.price).toBe(293000);
    expect(q?.priceSource).toBe("over");
    expect(q?.quotedAtMs).toBe(Date.parse("2026-05-22T20:00:00.000000+09:00"));
  });
});
