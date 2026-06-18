import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { upsertStockVaultItemSync, removeStockVaultItemSync } from "./stock-vault-store.js";
import { buildStockVaultItemsForUserSync } from "./stock-vault-view.js";
import { writeJsonStoreSync } from "./store-json.js";
import {
  addUserVaultFavoriteEntrySync,
  patchUserVaultFavoriteMetaSync,
  removeUserVaultSymbolSync,
  setUserVaultFavoriteSync,
} from "./user-stock-vault-store.js";

beforeEach(() => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  process.env.STOCK_VAULT_STORE_TEST_FILE = `stock-vault-test-${id}.json`;
  process.env.USER_STOCK_VAULT_STORE_TEST_FILE = `user-stock-vault-test-${id}.json`;
});

test("buildStockVaultItemsForUserSync merges global golden cross and user favorites", () => {
  const userId = `user-${Date.now()}`;
  const gcSym = `ZXGC${Date.now()}.KS`;
  const favSym = `ZXFAV${Date.now()}.KS`;

  try {
    upsertStockVaultItemSync({
      symbol: gcSym,
      name: "골든크로스공통",
      market: "kr",
      source: "golden_cross",
      crosses: ["5>20"],
      scanDate: "2026-05-29",
    });
    addUserVaultFavoriteEntrySync(userId, {
      symbol: favSym,
      name: "즐겨찾기보관",
      market: "kr",
    });

    const guest = buildStockVaultItemsForUserSync(null);
    assert.equal(guest.authenticated, false);
    assert.ok(guest.items.some((it) => it.symbol === gcSym));
    assert.ok(!guest.items.some((it) => it.symbol === favSym));

    const mine = buildStockVaultItemsForUserSync(userId);
    assert.equal(mine.authenticated, true);
    assert.ok(mine.items.some((it) => it.symbol === gcSym));
    assert.ok(mine.items.some((it) => it.symbol === favSym && it.source === "favorite"));
    assert.ok(mine.favoriteSymbols.includes(favSym));
  } finally {
    removeUserVaultSymbolSync(userId, favSym);
    removeStockVaultItemSync(gcSym);
  }
});

test("buildStockVaultItemsForUserSync includes low_slope_flip auto items", () => {
  const sym = `ZXLS${Date.now()}.KS`;
  try {
    upsertStockVaultItemSync({
      symbol: sym,
      name: "저점기울기",
      market: "kr",
      source: "low_slope_flip",
      timeframe: "1d",
      scanDate: "2026-06-18",
      lowSlopeFlip: "down_to_up",
      pivotLow: 12345,
    });

    const guest = buildStockVaultItemsForUserSync(null);
    assert.ok(
      guest.items.some(
        (it) => it.symbol === sym && it.source === "low_slope_flip",
      ),
    );
  } finally {
    removeStockVaultItemSync(sym);
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

test("setUserVaultFavoriteSync stores favoritePrice and addedAtMs", () => {
  const userId = `user-fav-${Date.now()}`;
  const sym = `ZXFP${Date.now()}.KS`;
  try {
    const { favorited, meta } = setUserVaultFavoriteSync(userId, sym, true, {
      name: "테스트",
      market: "kr",
      favoritePrice: 10000,
    });
    assert.equal(favorited, true);
    assert.ok(meta);
    assert.equal(meta.favoritePrice, 10000);
    assert.ok(meta.addedAtMs > 0);

    const patched = patchUserVaultFavoriteMetaSync(userId, sym, {
      favoritePrice: 12000,
    });
    assert.equal(patched.favoritePrice, 12000);
  } finally {
    removeUserVaultSymbolSync(userId, sym);
  }
});

test("legacy manualItems migrate into favorites", () => {
  const userId = `user-migrate-${Date.now()}`;
  const sym = `ZXLEG${Date.now()}.KS`;
  process.env.USER_STOCK_VAULT_STORE_TEST_FILE = `user-stock-vault-migrate-${Date.now()}.json`;
  writeJsonStoreSync(process.env.USER_STOCK_VAULT_STORE_TEST_FILE, {
    version: 1,
    users: [
      {
        userId,
        manualItems: [
          {
            id: "legacy-1",
            symbol: sym,
            name: "레거시수동",
            market: "kr",
            source: "manual",
            addedAtMs: 1,
            updatedAtMs: 2,
          },
        ],
        favorites: [],
        dismissed: [],
        updatedAtMs: 3,
      },
    ],
  });

  const view = buildStockVaultItemsForUserSync(userId);
  assert.ok(view.favoriteSymbols.includes(sym));
  assert.ok(view.items.some((it) => it.symbol === sym && it.source === "favorite"));
});
