import { describe, it, expect } from "vitest";
import {
  bithumbAccountQtyMapsFromAccounts,
  clampBithumbSellVolumeToAvailable,
} from "./live-trade-bithumb-reconcile.js";

describe("bithumbAccountQtyMapsFromAccounts", () => {
  it("splits balance vs locked", () => {
    const { total, available } = bithumbAccountQtyMapsFromAccounts([
      { currency: "SOL", balance: 0.5, locked: 0.2 },
      { currency: "KRW", balance: 1000, locked: 0 },
    ]);
    expect(total.get("SOL")).toBe(0.7);
    expect(available.get("SOL")).toBe(0.5);
    expect(total.has("KRW")).toBe(false);
  });
});

describe("clampBithumbSellVolumeToAvailable", () => {
  it("uses min of app and available", () => {
    expect(clampBithumbSellVolumeToAvailable(1.5, 1.2)).toEqual({ volume: 1.2, clamped: true });
    expect(clampBithumbSellVolumeToAvailable(1, 2)).toEqual({ volume: 1, clamped: false });
    expect(clampBithumbSellVolumeToAvailable(1, 0)).toEqual({ volume: 0, clamped: false });
  });
});
