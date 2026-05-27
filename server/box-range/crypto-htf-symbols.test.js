import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";

describe("box-range crypto HTF symbols", () => {
  it("allows BTC, ETH, SOL", () => {
    assert.deepEqual(BOX_RANGE_CRYPTO_HTF_SYMBOLS, ["BTC-USDT", "ETH-USDT", "SOL-USDT"]);
    assert.equal(isBoxRangeCryptoHtfSymbol("BTC-USDT"), true);
    assert.equal(isBoxRangeCryptoHtfSymbol("ETH-USDT"), true);
    assert.equal(isBoxRangeCryptoHtfSymbol("SOL-USDT"), true);
    assert.equal(isBoxRangeCryptoHtfSymbol("XRP-USDT"), false);
  });

  it("restricts 1h/4h/1d crypto to HTF symbols (BTC·ETH·SOL)", () => {
    assert.equal(isBoxRangeCryptoHtfManaged("SOL-USDT", "1h"), true);
    assert.equal(isBoxRangeCryptoHtfManaged("ETH-USDT", "4h"), true);
    assert.equal(isBoxRangeCryptoHtfManaged("BTC-USDT", "1d"), true);
    assert.equal(isBoxRangeCryptoHtfManaged("XRP-USDT", "1h"), false);
  });
});
