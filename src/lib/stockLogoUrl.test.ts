import { describe, expect, it } from "vitest";
import { krStockLogoTicker, krStockLogoUrl, stockLogoUrl } from "./stockLogoUrl";

describe("stockLogoUrl", () => {
  it("builds FMP KR logo URL with exchange suffix", () => {
    expect(krStockLogoTicker("005930.KS")).toBe("005930.KS");
    expect(krStockLogoUrl("005930.KS")).toBe(
      "https://financialmodelingprep.com/image-stock/005930.KS.png",
    );
    expect(krStockLogoUrl("035420.KQ")).toBe(
      "https://financialmodelingprep.com/image-stock/035420.KQ.png",
    );
  });

  it("defaults KR suffix to KS for bare code", () => {
    expect(krStockLogoTicker("005930")).toBe("005930.KS");
  });

  it("stockLogoUrl routes kr market to KR logo", () => {
    expect(stockLogoUrl("000660.KS", "kr")).toContain("000660.KS.png");
  });
});
