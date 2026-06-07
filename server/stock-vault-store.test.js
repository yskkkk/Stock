import { test } from "vitest";
import assert from "node:assert/strict";
import {
  listStockVaultItemsSync,
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
