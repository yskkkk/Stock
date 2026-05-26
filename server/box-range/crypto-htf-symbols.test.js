import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";

describe("box-range crypto HTF symbols", () => {
  it("allows only BTC and ETH", () => {
    assert.deepEqual(BOX_RANGE_CRYPTO_HTF_SYMBOLS, ["BTC-USDT", "ETH-USDT"]);
    assert.equal(isBoxRangeCryptoHtfSymbol("BTC-USDT"), true);
    assert.equal(isBoxRangeCryptoHtfSymbol("ETH-USDT"), true);
    assert.equal(isBoxRangeCryptoHtfSymbol("SOL-USDT"), false);
  });

  it("restricts 1h/4h/1d crypto to BTC and ETH", () => {
    assert.equal(isBoxRangeCryptoHtfManaged("SOL-USDT", "1h"), false);
    assert.equal(isBoxRangeCryptoHtfManaged("ETH-USDT", "4h"), true);
    assert.equal(isBoxRangeCryptoHtfManaged("BTC-USDT", "1d"), true);
  });
});
