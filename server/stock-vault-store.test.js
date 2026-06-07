import { test } from "vitest";
import assert from "node:assert/strict";
import {
  listStockVaultItemsSync,
  mergeGoldenCrossHitsIntoVaultSync,
  removeStockVaultItemSync,
  upsertStockVaultItemSync,
} from "./stock-vault-store.js";

test("stock vault manual upsert and remove", () => {
  const sym = `TEST${Date.now()}.KS`;
  upsertStockVaultItemSync({
    symbol: sym,
    name: "테스트",
    market: "kr",
    source: "manual",
  });
  const items = listStockVaultItemsSync();
  assert.ok(items.some((it) => it.symbol === sym));
  assert.ok(removeStockVaultItemSync(sym));
});

test("removed golden cross symbols stay dismissed", () => {
  const sym = `GC${Date.now()}.KS`;
  upsertStockVaultItemSync({
    symbol: sym,
    name: "골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-05-29",
  });
  assert.ok(removeStockVaultItemSync(sym));
  mergeGoldenCrossHitsIntoVaultSync([
    {
      symbol: sym,
      name: "골든",
      market: "kr",
      crosses: ["5>20"],
      scanDate: "2026-05-29",
    },
  ]);
  assert.ok(!listStockVaultItemsSync().some((it) => it.symbol === sym));
});
