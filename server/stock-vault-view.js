import { listStockVaultItemsSync } from "./stock-vault-store.js";
import { resolveDisplayName } from "./names-ko.js";
import {
  addUserVaultFavoriteEntrySync,
  getUserStockVaultSync,
  patchUserVaultFavoriteMetaSync,
  removeUserVaultSymbolSync,
  setUserVaultFavoriteSync,
} from "./user-stock-vault-store.js";
import { normalizeVaultScanTimeframe } from "./vault-scan-timeframe.js";

/**
 * @param {import("./user-stock-vault-store.js").UserFavoriteMeta | undefined} meta
 */
function favoriteFieldsFromMeta(meta) {
  if (!meta) return {};
  return {
    favoriteAddedAtMs: meta.addedAtMs,
    favoritePrice: meta.favoritePrice ?? null,
  };
}

/**
 * @param {import("./stock-vault-store.js").StockVaultItem & { favorited?: boolean }} it
 * @param {Set<string>} favorites
 * @param {Record<string, import("./user-stock-vault-store.js").UserFavoriteMeta>} favoriteMeta
 */
function withFavoriteFields(it, favorites, favoriteMeta) {
  const favorited = favorites.has(it.symbol) || it.source === "favorite";
  const meta = favoriteMeta[it.symbol];
  return {
    ...it,
    favorited,
    ...favoriteFieldsFromMeta(meta),
  };
}

/**
 * @param {string | null | undefined} userId
 */
export function buildStockVaultItemsForUserSync(userId) {
  const globalAuto = listStockVaultItemsSync().filter(
    (it) =>
      it.source === "golden_cross" ||
      it.source === "ma_align" ||
      it.source === "ma120_near",
  );
  if (!userId) {
    return {
      authenticated: false,
      favoriteSymbols: [],
      favoriteMeta: {},
      items: globalAuto.map((it) => ({
        ...it,
        name: resolveDisplayName(it.symbol, it.name),
        favorited: false,
      })),
    };
  }

  const userVault = getUserStockVaultSync(userId);
  const dismissed = new Set(userVault.dismissed);
  const favorites = new Set(userVault.favorites);
  const favoriteMeta = userVault.favoriteMeta ?? {};
  /** @type {Map<string, import("./stock-vault-store.js").StockVaultItem & { favorited?: boolean }>} */
  const byKey = new Map();
  const autoSymbols = new Set();

  for (const it of globalAuto) {
    if (dismissed.has(it.symbol)) continue;
    autoSymbols.add(it.symbol);
    byKey.set(
      `${it.symbol}:${it.source}:${normalizeVaultScanTimeframe(it.timeframe)}`,
      withFavoriteFields(it, favorites, favoriteMeta),
    );
  }

  for (const sym of favorites) {
    if (dismissed.has(sym) || autoSymbols.has(sym)) continue;
    const meta = favoriteMeta[sym];
    if (!meta) continue;
    byKey.set(`${sym}:favorite`, {
      id: sym,
      symbol: sym,
      name: meta.name,
      market: meta.market,
      source: "favorite",
      addedAtMs: meta.addedAtMs,
      updatedAtMs: meta.updatedAtMs,
      favorited: true,
      ...favoriteFieldsFromMeta(meta),
    });
  }

  const items = [...byKey.values()]
    .map((it) => ({
      ...it,
      name: resolveDisplayName(it.symbol, it.name),
    }))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return {
    authenticated: true,
    favoriteSymbols: [...favorites],
    favoriteMeta,
    items,
  };
}

/**
 * @param {string} userId
 * @param {{ symbol: string; name?: string; market: "kr"|"us"; favoritePrice?: number | null }} input
 */
export function addStockVaultItemForUserSync(userId, input) {
  return addUserVaultFavoriteEntrySync(userId, input);
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
 * @param {{ name?: string; market?: "kr"|"us"; favoritePrice?: number | null }} [opts]
 */
export function setStockVaultFavoriteForUserSync(userId, symbol, favorited, opts) {
  return setUserVaultFavoriteSync(userId, symbol, favorited, opts);
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {{ favoritePrice?: number | null }} patch
 */
export function patchStockVaultFavoriteMetaForUserSync(userId, symbol, patch) {
  return patchUserVaultFavoriteMetaSync(userId, symbol, patch);
}
