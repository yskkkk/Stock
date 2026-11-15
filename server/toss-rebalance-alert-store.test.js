import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("toss-rebalance-alert-store", () => {
  /** @type {string} */
  let dataDir;
  /** @type {string | undefined} */
  let prevDataDir;

  beforeEach(() => {
    prevDataDir = process.env.STOCK_DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "toss-rebal-alert-"));
    process.env.STOCK_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.STOCK_DATA_DIR;
    else process.env.STOCK_DATA_DIR = prevDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("defaults to disabled with 5pp threshold", async () => {
    const {
      readTossRebalanceAlertSettingsSync,
      DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT,
    } = await import("./toss-rebalance-alert-store.js");
    const s = readTossRebalanceAlertSettingsSync("user-a");
    expect(s.enabled).toBe(false);
    expect(s.thresholdPctPoints).toBe(DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT);
    expect(DEFAULT_TOSS_REBALANCE_DRIFT_THRESHOLD_PCT).toBe(5);
  });

  it("keeps settings isolated per userId", async () => {
    const { updateTossRebalanceAlertSettingsSync, readTossRebalanceAlertSettingsSync } =
      await import("./toss-rebalance-alert-store.js");
    updateTossRebalanceAlertSettingsSync("user-a", {
      enabled: true,
      thresholdPctPoints: 8,
    });
    updateTossRebalanceAlertSettingsSync("user-b", {
      enabled: false,
      thresholdPctPoints: 3,
    });
    const a = readTossRebalanceAlertSettingsSync("user-a");
    const b = readTossRebalanceAlertSettingsSync("user-b");
    expect(a.enabled).toBe(true);
    expect(a.thresholdPctPoints).toBe(8);
    expect(b.enabled).toBe(false);
    expect(b.thresholdPctPoints).toBe(3);
  });

  it("clamps threshold", async () => {
    const { updateTossRebalanceAlertSettingsSync, readTossRebalanceAlertSettingsSync } =
      await import("./toss-rebalance-alert-store.js");
    updateTossRebalanceAlertSettingsSync("user-c", { thresholdPctPoints: 999 });
    expect(readTossRebalanceAlertSettingsSync("user-c").thresholdPctPoints).toBe(50);
    updateTossRebalanceAlertSettingsSync("user-c", { thresholdPctPoints: 0 });
    expect(readTossRebalanceAlertSettingsSync("user-c").thresholdPctPoints).toBe(0.5);
  });
});
