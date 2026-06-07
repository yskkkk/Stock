import { test } from "vitest";
import assert from "node:assert/strict";
import {
  evaluateMa120NearHit,
  ma120NearDistancePct,
} from "./ma-align-ma120-watch.js";
import { isPriceNearMa120 } from "./ma-align-detect.js";
import { shouldRunVaultIntradayRescan } from "./golden-cross-poller.js";

test("isPriceNearMa120 within threshold", () => {
  assert.equal(isPriceNearMa120(102, 100, 2), true);
  assert.equal(isPriceNearMa120(98, 100, 2), true);
  assert.equal(isPriceNearMa120(103, 100, 2), false);
});

test("ma120NearDistancePct", () => {
  assert.equal(ma120NearDistancePct(101, 100), 1);
  assert.equal(ma120NearDistancePct(100, 100), 0);
});

test("evaluateMa120NearHit on aligned rising series near ma120", () => {
  /** @type {{ close: number }[]} */
  const candles = [];
  for (let i = 0; i < 140; i++) {
    candles.push({ close: 80 + i * 0.5 });
  }
  const ma120 = candles.slice(-120).reduce((s, c) => s + c.close, 0) / 120;
  const hit = evaluateMa120NearHit({
    symbol: "TEST",
    name: "Test",
    market: "kr",
    price: ma120 * 1.01,
    candles,
    thresholdPct: 2,
  });
  assert.ok(hit);
  assert.ok(hit.distancePct <= 2);
});

test("evaluateMa120NearHit rejects when not aligned", () => {
  const candles = Array.from({ length: 140 }, () => ({ close: 100 }));
  const hit = evaluateMa120NearHit({
    symbol: "FLAT",
    name: "Flat",
    market: "kr",
    price: 100,
    candles,
    thresholdPct: 2,
  });
  assert.equal(hit, null);
});

test("shouldRunVaultIntradayRescan respects interval", () => {
  const now = new Date("2026-06-08T03:00:00.000Z"); // KR regular session
  assert.equal(
    shouldRunVaultIntradayRescan("kr", Date.now() - 901_000, now),
    true,
  );
  assert.equal(
    shouldRunVaultIntradayRescan("kr", Date.now() - 100_000, now),
    false,
  );
});
