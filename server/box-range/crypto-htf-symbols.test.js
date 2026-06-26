import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  boxRangeCryptoScanEnabled,
  isBoxRangeCryptoHtfManaged,
  isBoxRangeCryptoHtfSymbol,
} from "./constants.js";
import { startCryptoBoxRangeCatalogPoller } from "./crypto-scan-runner.js";
import { notifyBoxRangeDipRecoveryEntry } from "./box-range-telegram.js";
import { notifyCatalogScanTelegram } from "./catalog-scan-telegram.js";
import { collectWatchSymbolsForProgram } from "./watch-symbols.js";
import { scheduleBoxRangeFsmOnWsPrice } from "./ws-fsm.js";

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

  it("skips crypto box-range telegram when disabled", async () => {
    const ok = await notifyBoxRangeDipRecoveryEntry(
      {
        symbol: "BTC-USDT",
        timeframe: "4h",
        top: 100,
        bottom: 90,
        mid: 95,
        dipLow: 89,
      },
      { id: "p1", name: "test", status: "sim" },
      96,
      "crypto",
    );
    assert.equal(ok, false);
  });

  it("skips crypto catalog scan telegram when disabled", async () => {
    const out = await notifyCatalogScanTelegram("crypto", { scanned: 3 });
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "crypto_telegram_disabled");
  });

  it("ws-fsm no-ops for crypto when disabled", () => {
    scheduleBoxRangeFsmOnWsPrice("BTC-USDT");
    // no throw — debounce map stays empty when disabled
  });
});
