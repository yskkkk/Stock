import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  boxRangeCryptoScanEnabled,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";
import { startCryptoBoxRangeCatalogPoller } from "./crypto-scan-runner.js";
import { collectWatchSymbolsForProgram } from "./watch-symbols.js";

describe("box-range crypto HTF symbols", () => {
  it("crypto catalog scan is disabled", () => {
    assert.equal(boxRangeCryptoScanEnabled(), false);
  });

  it("crypto catalog poller does not start when disabled", () => {
    const g = /** @type {typeof globalThis & { __stockBoxRangeCryptoScan?: boolean }} */ (
      globalThis
    );
    const prev = g.__stockBoxRangeCryptoScan;
    delete g.__stockBoxRangeCryptoScan;
    startCryptoBoxRangeCatalogPoller();
    assert.equal(g.__stockBoxRangeCryptoScan, undefined);
    if (prev) g.__stockBoxRangeCryptoScan = prev;
  });

  it("does not seed HTF symbols for watch when coin scan is off", async () => {
    const symbols = await collectWatchSymbolsForProgram({ id: "test-empty" });
    assert.deepEqual(symbols, []);
  });

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
