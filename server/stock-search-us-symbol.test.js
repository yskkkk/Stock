import { describe, it, expect } from "vitest";
import {
  isPrimaryUsSearchSymbol,
  isUsSearchResultRow,
} from "./stock-search-us-symbol.js";

describe("isPrimaryUsSearchSymbol", () => {
  it("allows plain US tickers", () => {
    expect(isPrimaryUsSearchSymbol("RGTI")).toBe(true);
    expect(isPrimaryUsSearchSymbol("BRK-A")).toBe(true);
  });

  it("allows US share-class dots", () => {
    expect(isPrimaryUsSearchSymbol("BRK.B")).toBe(true);
  });

  it("blocks foreign cross-listings", () => {
    expect(isPrimaryUsSearchSymbol("RGTI.MX")).toBe(false);
    expect(isPrimaryUsSearchSymbol("RGTID.BA")).toBe(false);
    expect(isPrimaryUsSearchSymbol("AAPL.TO")).toBe(false);
  });

  it("blocks KR suffixes", () => {
    expect(isPrimaryUsSearchSymbol("005930.KS")).toBe(false);
  });

  it("allows Yahoo index tickers", () => {
    expect(isPrimaryUsSearchSymbol("^GSPC")).toBe(true);
    expect(isPrimaryUsSearchSymbol("^KS11")).toBe(true);
  });
});

describe("isUsSearchResultRow", () => {
  it("blocks non-USD currency", () => {
    expect(isUsSearchResultRow({ symbol: "RGTI.MX", currency: "MXN" })).toBe(false);
    expect(isUsSearchResultRow({ symbol: "RGTI", currency: "USD" })).toBe(true);
  });

  it("allows index rows without USD currency", () => {
    expect(
      isUsSearchResultRow({ symbol: "^IXIC", quoteType: "INDEX", currency: "USD" }),
    ).toBe(true);
    expect(
      isUsSearchResultRow({ symbol: "^KS11", quoteType: "INDEX", currency: "KRW" }),
    ).toBe(true);
  });
});
