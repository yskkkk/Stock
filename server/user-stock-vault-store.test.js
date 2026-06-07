import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { upsertStockVaultItemSync, removeStockVaultItemSync } from "./stock-vault-store.js";
import { buildStockVaultItemsForUserSync } from "./stock-vault-view.js";
import {
  setUserVaultFavoriteSync,
  upsertUserManualVaultItemSync,
  removeUserVaultSymbolSync,
} from "./user-stock-vault-store.js";

beforeEach(() => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-test-${id}.json`;
  process.env.USER_STOCK_VAULT_STORE_TEST_FILE = `user-stock-vault-test-${id}.json`;
});

test("buildStockVaultItemsForUserSync merges global golden cross and user manual", () => {
  const userId = `user-${Date.now()}`;
  const gcSym = `ZXGC${Date.now()}.KS`;
  const manualSym = `ZXMAN${Date.now()}.KS`;

  try {
    upsertStockVaultItemSync({
      symbol: gcSym,
      name: "골든크로스공통",
      market: "kr",
      source: "golden_cross",
      crosses: ["5>20"],
      scanDate: "2026-05-29",
    });
    upsertUserManualVaultItemSync(userId, {
      symbol: manualSym,
      name: "수동보관",
      market: "kr",
    });

    const guest = buildStockVaultItemsForUserSync(null);
    assert.equal(guest.authenticated, false);
    assert.ok(guest.items.some((it) => it.symbol === gcSym));
    assert.ok(!guest.items.some((it) => it.symbol === manualSym));

    const mine = buildStockVaultItemsForUserSync(userId);
    assert.equal(mine.authenticated, true);
    assert.ok(mine.items.some((it) => it.symbol === gcSym));
    assert.ok(mine.items.some((it) => it.symbol === manualSym));
  } finally {
    removeUserVaultSymbolSync(userId, manualSym);
    removeStockVaultItemSync(gcSym);
  }
});

test("user favorites and dismiss are scoped per account", () => {
  const userA = `userA-${Date.now()}`;
  const userB = `userB-${Date.now()}`;
  const sym = `ZXFAV${Date.now()}.KS`;

  try {
    upsertStockVaultItemSync({
      symbol: sym,
      name: "즐겨찾기공통",
      market: "kr",
      source: "golden_cross",
      crosses: ["5>60"],
      scanDate: "2026-05-29",
    });

    setUserVaultFavoriteSync(userA, sym, true);
    removeUserVaultSymbolSync(userB, sym);

    const viewA = buildStockVaultItemsForUserSync(userA);
    const viewB = buildStockVaultItemsForUserSync(userB);

    assert.ok(viewA.items.some((it) => it.symbol === sym && it.favorited));
    assert.ok(!viewB.items.some((it) => it.symbol === sym));
  } finally {
    removeUserVaultSymbolSync(userA, sym);
    removeUserVaultSymbolSync(userB, sym);
    removeStockVaultItemSync(sym);
  }
});
