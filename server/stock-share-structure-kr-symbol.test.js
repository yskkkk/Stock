import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { yahooSymbolToKrCode } from "./kr-naver-quote.js";

describe("yahooSymbolToKrCode for share-structure", () => {
  it("strips .KS/.KQ suffix for FnGuide gicode", () => {
    assert.equal(yahooSymbolToKrCode("035250.KS"), "035250");
    assert.equal(yahooSymbolToKrCode("005930.KQ"), "005930");
  });

  it("rejects invalid gicode that would hit Samsung default page", () => {
    assert.equal(yahooSymbolToKrCode("035250.KS"), "035250");
    assert.notEqual(`A${yahooSymbolToKrCode("035250.KS")}`, "A035250.KS");
  });
});
