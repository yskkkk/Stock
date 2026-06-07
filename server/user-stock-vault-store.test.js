import { test } from "vitest";
import assert from "node:assert/strict";
import { upsertStockVaultItemSync } from "./stock-vault-store.js";
import { buildStockVaultItemsForUserSync } from "./stock-vault-view.js";
import {
  setUserVaultFavoriteSync,
  upsertUserManualVaultItemSync,
  removeUserVaultSymbolSync,
} from "./user-stock-vault-store.js";

test("buildStockVaultItemsForUserSync merges global golden cross and user manual", () => {
  const userId = `user-${Date.now()}`;
  const gcSym = `GCV${Date.now()}.KS`;
  const manualSym = `MAN${Date.now()}.KS`;

  upsertStockVaultItemSync({
    symbol: gcSym,
    name: "골든",
    market: "kr",
    source: "golden_cross",
    crosses: ["5>20"],
    scanDate: "2026-05-29",
  });
  upsertUserManualVaultItemSync(userId, {
    symbol: manualSym,
    name: "수동",
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
});

test("user favorites and dismiss are scoped per account", () => {
  const userA = `userA-${Date.now()}`;
  const userB = `userB-${Date.now()}`;
  const sym = `FAV${Date.now()}.KS`;

  upsertStockVaultItemSync({
    symbol: sym,
    name: "즐겨",
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
});
