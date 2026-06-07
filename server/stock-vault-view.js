import { listStockVaultItemsSync } from "./stock-vault-store.js";
import { resolveDisplayName } from "./names-ko.js";
import {
  getUserStockVaultSync,
  removeUserVaultSymbolSync,
  setUserVaultFavoriteSync,
  upsertUserManualVaultItemSync,
} from "./user-stock-vault-store.js";

/**
 * @param {string | null | undefined} userId
 */
export function buildStockVaultItemsForUserSync(userId) {
  const globalGolden = listStockVaultItemsSync().filter(
    (it) => it.source === "golden_cross",
  );
  if (!userId) {
    return {
      authenticated: false,
      favoriteSymbols: [],
      items: globalGolden.map((it) => ({
        ...it,
        name: resolveDisplayName(it.symbol, it.name),
        favorited: false,
      })),
    };
  }

  const userVault = getUserStockVaultSync(userId);
  const dismissed = new Set(userVault.dismissed);
  const favorites = new Set(userVault.favorites);
  /** @type {Map<string, import("./stock-vault-store.js").StockVaultItem & { favorited?: boolean }>} */
  const bySymbol = new Map();

  for (const it of globalGolden) {
    if (dismissed.has(it.symbol)) continue;
    bySymbol.set(it.symbol, { ...it, favorited: favorites.has(it.symbol) });
  }
  for (const it of userVault.manualItems) {
    bySymbol.set(it.symbol, { ...it, favorited: favorites.has(it.symbol) });
  }

  const items = [...bySymbol.values()]
    .map((it) => ({
      ...it,
      name: resolveDisplayName(it.symbol, it.name),
    }))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return {
    authenticated: true,
    favoriteSymbols: [...favorites],
    items,
  };
}

/**
 * @param {string} userId
 * @param {{ symbol: string; name?: string; market: "kr"|"us" }} input
 */
export function addStockVaultItemForUserSync(userId, input) {
  return upsertUserManualVaultItemSync(userId, input);
}

/**
 * @param {string} userId
 * @param {string} symbol
 */
export function removeStockVaultItemForUserSync(userId, symbol) {
  return removeUserVaultSymbolSync(userId, symbol);
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {boolean} favorited
 */
export function setStockVaultFavoriteForUserSync(userId, symbol, favorited) {
  return setUserVaultFavoriteSync(userId, symbol, favorited);
}
