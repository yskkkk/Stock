import { describe, expect, it } from "vitest";
import {
  LIVE_TRADE_CANONICAL_SELL_SETTINGS,
  LIVE_TRADE_SELL_SETTINGS_VERSION,
} from "./live-trade-programs-store.js";
import { buildSellSettingsMigrationPatch } from "./live-trade-settings-migrate.js";

describe("live-trade-settings-migrate", () => {
  it("builds patch for legacy program without version", () => {
    const patch = buildSellSettingsMigrationPatch({
      id: "p1",
      name: "test",
      sellSettingsVersion: 0,
      sellHorizon: "medium",
      autoSellAtTarget: false,
      takeProfitPct: null,
      stopLossPct: null,
    });
    expect(patch).not.toBeNull();
    expect(patch?.sellHorizon).toBe(LIVE_TRADE_CANONICAL_SELL_SETTINGS.sellHorizon);
    expect(patch?.autoSellAtTarget).toBe(true);
    expect(patch?.takeProfitPct).toBe(5);
    expect(patch?.stopLossPct).toBe(-3);
    expect(patch?.sellSettingsVersion).toBe(LIVE_TRADE_SELL_SETTINGS_VERSION);
  });

  it("skips program already on current version", () => {
    expect(
      buildSellSettingsMigrationPatch({
        id: "p2",
        sellSettingsVersion: LIVE_TRADE_SELL_SETTINGS_VERSION,
      }),
    ).toBeNull();
  });
});
