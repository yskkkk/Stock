import { test } from "vitest";
import assert from "node:assert/strict";
import {
  goldenCrossScanEnabled,
  isGoldenCrossManualScanRunning,
  triggerGoldenCrossManualScan,
} from "./golden-cross-poller.js";

test("triggerGoldenCrossManualScan returns disabled when scan off", () => {
  const prev = process.env.STOCK_GOLDEN_CROSS_SCAN;
  process.env.STOCK_GOLDEN_CROSS_SCAN = "0";
  try {
    assert.equal(triggerGoldenCrossManualScan().started, false);
    assert.equal(triggerGoldenCrossManualScan().reason, "disabled");
  } finally {
    if (prev == null) delete process.env.STOCK_GOLDEN_CROSS_SCAN;
    else process.env.STOCK_GOLDEN_CROSS_SCAN = prev;
  }
});

test("triggerGoldenCrossManualScan reports busy while running", () => {
  if (!goldenCrossScanEnabled()) return;
  if (isGoldenCrossManualScanRunning()) return;
  const first = triggerGoldenCrossManualScan();
  if (!first.started) return;
  const second = triggerGoldenCrossManualScan();
  assert.equal(second.started, false);
  assert.equal(second.reason, "busy");
});
