import test from "node:test";
import assert from "node:assert/strict";
import {
  bithumbAccountQtyMapsFromAccounts,
  clampBithumbSellVolumeToAvailable,
} from "./live-trade-bithumb-reconcile.js";

test("bithumbAccountQtyMapsFromAccounts splits balance vs locked", () => {
  const { total, available } = bithumbAccountQtyMapsFromAccounts([
    { currency: "SOL", balance: 0.5, locked: 0.2 },
    { currency: "KRW", balance: 1000, locked: 0 },
  ]);
  assert.equal(total.get("SOL"), 0.7);
  assert.equal(available.get("SOL"), 0.5);
  assert.equal(total.has("KRW"), false);
});

test("clampBithumbSellVolumeToAvailable uses min of app and available", () => {
  assert.deepEqual(clampBithumbSellVolumeToAvailable(1.5, 1.2), {
    volume: 1.2,
    clamped: true,
  });
  assert.deepEqual(clampBithumbSellVolumeToAvailable(1, 2), {
    volume: 1,
    clamped: false,
  });
  assert.deepEqual(clampBithumbSellVolumeToAvailable(1, 0), {
    volume: 0,
    clamped: false,
  });
});
