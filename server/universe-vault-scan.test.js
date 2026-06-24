import { test } from "vitest";
import assert from "node:assert/strict";
import {
  BOOK_ACCUM_KR_UNIVERSE_SCOPE,
  BOOK_ACCUM_US_UNIVERSE_SCOPE,
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

test("resolveBookAccumUniverseScope uses full toss tradable universe", () => {
  assert.equal(resolveBookAccumUniverseScope("kr", "1d"), BOOK_ACCUM_KR_UNIVERSE_SCOPE);
  assert.equal(resolveBookAccumUniverseScope("kr", "1wk"), BOOK_ACCUM_KR_UNIVERSE_SCOPE);
  assert.equal(resolveBookAccumUniverseScope("us", "1d"), BOOK_ACCUM_US_UNIVERSE_SCOPE);
  assert.equal(resolveBookAccumUniverseScope("us", "1wk"), BOOK_ACCUM_US_UNIVERSE_SCOPE);
});
