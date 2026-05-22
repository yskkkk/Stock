import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPrimaryUsSearchSymbol,
  isUsSearchResultRow,
} from "./stock-search-us-symbol.js";

describe("isPrimaryUsSearchSymbol", () => {
  it("allows plain US tickers", () => {
    assert.equal(isPrimaryUsSearchSymbol("RGTI"), true);
    assert.equal(isPrimaryUsSearchSymbol("BRK-A"), true);
  });

  it("allows US share-class dots", () => {
    assert.equal(isPrimaryUsSearchSymbol("BRK.B"), true);
  });

  it("blocks foreign cross-listings", () => {
    assert.equal(isPrimaryUsSearchSymbol("RGTI.MX"), false);
    assert.equal(isPrimaryUsSearchSymbol("RGTID.BA"), false);
    assert.equal(isPrimaryUsSearchSymbol("AAPL.TO"), false);
  });

  it("blocks KR suffixes", () => {
    assert.equal(isPrimaryUsSearchSymbol("005930.KS"), false);
  });
});

describe("isUsSearchResultRow", () => {
  it("blocks non-USD currency", () => {
    assert.equal(
      isUsSearchResultRow({ symbol: "RGTI.MX", currency: "MXN" }),
      false,
    );
    assert.equal(
      isUsSearchResultRow({ symbol: "RGTI", currency: "USD" }),
      true,
    );
  });
});
