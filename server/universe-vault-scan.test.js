import { test } from "vitest";
import assert from "node:assert/strict";
import {
  US_VAULT_WEEKLY_UNIVERSE_SCOPE,
  resolveBookAccumUniverseScope,
  resolveVaultScanUniverseScope,
} from "./universe.js";

test("resolveVaultScanUniverseScope uses nasdaq for US weekly", () => {
  assert.equal(resolveVaultScanUniverseScope("kr", "1d"), "kr-top");
  assert.equal(resolveVaultScanUniverseScope("us", "1d"), "sp500");
  assert.equal(resolveVaultScanUniverseScope("us", "1wk"), US_VAULT_WEEKLY_UNIVERSE_SCOPE);
  assert.equal(resolveVaultScanUniverseScope("us", "weekly"), "nasdaq");
});

test("resolveBookAccumUniverseScope uses nasdaq for US weekly", () => {
  assert.equal(resolveBookAccumUniverseScope("kr", "1wk"), "sp500");
  assert.equal(resolveBookAccumUniverseScope("us", "1d"), "toss-us");
  assert.equal(resolveBookAccumUniverseScope("us", "1wk"), "nasdaq");
});
