import { test } from "vitest";
import assert from "node:assert/strict";
import {
  krwCodeToYahooSymbol,
  yahooSymbolToKrwCode,
} from "./bithumb-ws-ticker.js";

test("yahooSymbolToKrwCode and reverse", () => {
  assert.equal(yahooSymbolToKrwCode("BTC-USDT"), "KRW-BTC");
  assert.equal(krwCodeToYahooSymbol("KRW-ETH"), "ETH-USDT");
  assert.equal(krwCodeToYahooSymbol("invalid"), null);
});
