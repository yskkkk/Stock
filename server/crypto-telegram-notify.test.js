import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  cryptoTelegramNotifyEnabled,
  isCryptoTelegramTarget,
  shouldBlockCryptoTelegram,
} from "./crypto-telegram-notify.js";
import { notifyHighScorePick } from "./telegram-notify.js";

describe("crypto telegram notify", () => {
  it("is hard-disabled", () => {
    assert.equal(cryptoTelegramNotifyEnabled(), false);
  });

  it("detects crypto picks", () => {
    assert.equal(isCryptoTelegramTarget({ market: "crypto", symbol: "BTC-USDT" }), true);
    assert.equal(isCryptoTelegramTarget({ market: "us", symbol: "AAPL" }), false);
    assert.equal(isCryptoTelegramTarget({ market: "kr", symbol: "ETH-USDT" }), true);
  });

  it("blocks crypto market telegram", () => {
    assert.equal(shouldBlockCryptoTelegram("crypto"), true);
    assert.equal(shouldBlockCryptoTelegram("kr"), false);
  });

  it("notifyHighScorePick no-ops for crypto", () => {
    notifyHighScorePick({
      market: "crypto",
      symbol: "BTC-USDT",
      name: "Bitcoin",
      score: 99,
      techModelWeights: { rsi: 1 },
      signalIds: ["rsi"],
    });
  });
});
