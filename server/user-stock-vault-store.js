import { randomUUID } from "node:crypto";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

function userVaultStoreFile() {
  return process.env.USER_STOCK_VAULT_STORE_TEST_FILE?.trim() || "user-stock-vault.json";
}

/**
 * @typedef {{
 *   name: string;
 *   market: "kr"|"us";
 *   addedAtMs: number;
 *   updatedAtMs: number;
 *   favoritePrice?: number | null;
 * }} UserFavoriteMeta
 */

/**
 * @typedef {{
 *   userId: string;
 *   favorites: string[];
 *   favoriteMeta: Record<string, UserFavoriteMeta>;
 *   dismissed: string[];
 *   updatedAtMs: number;
 * }} UserStockVaultRow
 */

/** @typedef {{ version: 1; users: UserStockVaultRow[] }} UserStockVaultStore */

/** @param {unknown} arr */
function normSymbols(arr) {
  return [
    ...new Set(
      (Array.isArray(arr) ? arr : [])
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** @param {unknown} v */
function normFavoritePrice(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {unknown} raw */
function normalizeFavoriteMeta(raw) {
  /** @type {Record<string, UserFavoriteMeta>} */
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, row] of Object.entries(raw)) {
    const symbol = String(key ?? "")
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const market = row?.market === "us" ? "us" : "kr";
    const name = String(row?.name ?? symbol).trim() || symbol;
    const addedAtMs =
      typeof row?.addedAtMs === "number" && Number.isFinite(row.addedAtMs)
        ? row.addedAtMs
        : Date.now();
    const updatedAtMs =
      typeof row?.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs)
        ? row.updatedAtMs
        : addedAtMs;
    out[symbol] = {
      name,
      market,
      addedAtMs,
      updatedAtMs,
      favoritePrice: normFavoritePrice(row?.favoritePrice),
    };
  }
  return out;
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const users = Array.isArray(raw?.users) ? raw.users : [];
  /** @type {UserStockVaultRow[]} */
  const out = [];
  for (const row of users) {
    const userId = String(row?.userId ?? "").trim();
    if (!userId) continue;

    const favorites = normSymbols(row?.favorites);
    const favoriteMeta = normalizeFavoriteMeta(row?.favoriteMeta);

    for (const item of Array.isArray(row?.manualItems) ? row.manualItems : []) {
      const symbol = String(item?.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!symbol) continue;
      if (!favorites.includes(symbol)) favorites.push(symbol);
      if (!favoriteMeta[symbol]) {
        const addedAtMs =
          typeof item?.addedAtMs === "number" && Number.isFinite(item.addedAtMs)
            ? item.addedAtMs
            : Date.now();
        const updatedAtMs =
          typeof item?.updatedAtMs === "number" && Number.isFinite(item.updatedAtMs)
            ? item.updatedAtMs
            : addedAtMs;
        favoriteMeta[symbol] = {
          name: String(item?.name ?? symbol).trim() || symbol,
          market: item?.market === "us" ? "us" : "kr",
          addedAtMs,
          updatedAtMs,
        };
      }
    }

    out.push({
      userId,
      favorites,
      favoriteMeta,
      dismissed: normSymbols(row?.dismissed),
      updatedAtMs:
        typeof row?.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs)
          ? row.updatedAtMs
          : Date.now(),
    });
  }
  return { version: 1, users: out };
}

function emptyStore() {
  return /** @type {UserStockVaultStore} */ ({ version: 1, users: [] });
}

function readStore() {
  return readJsonStoreSync(userVaultStoreFile(), normalizeStore, emptyStore);
}

/** @param {UserStockVaultStore} data */
function writeStore(data) {
  writeJsonStoreSync(userVaultStoreFile(), normalizeStore(data));
}

/** @param {string} userId */
function ensureUserRow(store, userId) {
  const uid = String(userId ?? "").trim();
  let row = store.users.find((u) => u.userId === uid);
  if (!row) {
    row = {
      userId: uid,
      favorites: [],
      favoriteMeta: {},
      dismissed: [],
      updatedAtMs: Date.now(),
    };
    store.users.push(row);
  }
  return row;
}

/** @param {string} userId */
export function getUserStockVaultSync(userId) {
  const uid = String(userId ?? "").trim();
  const row = readStore().users.find((u) => u.userId === uid);
  return (
    row ?? {
      userId: uid,
      favorites: [],
      favoriteMeta: {},
      dismissed: [],
      updatedAtMs: Date.now(),
    }
  );
}

/**
 * @param {string} userId
 * @param {{ symbol: string; name?: string; market: "kr"|"us"; favoritePrice?: number | null }} input
 */
export function addUserVaultFavoriteEntrySync(userId, input) {
  const uid = String(userId ?? "").trim();
  const symbol = String(input.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!uid || !symbol) {
    const err = new Error("symbol required");
    err.code = "INVALID_SYMBOL";
    throw err;
  }
  const market = input.market === "us" ? "us" : "kr";
  const now = Date.now();
  const store = readStore();
  const row = ensureUserRow(store, uid);
  if (!row.favorites.includes(symbol)) row.favorites.push(symbol);
  const prev = row.favoriteMeta[symbol];
  const favoritePrice =
    input.favoritePrice !== undefined
      ? normFavoritePrice(input.favoritePrice)
      : (prev?.favoritePrice ?? null);
  row.favoriteMeta[symbol] = {
    name: String(input.name ?? prev?.name ?? symbol).trim() || symbol,
    market,
    addedAtMs: prev?.addedAtMs ?? now,
    updatedAtMs: now,
    favoritePrice,
  };
  row.dismissed = row.dismissed.filter((s) => s !== symbol);
  row.updatedAtMs = now;
  writeStore(store);
  return {
    id: randomUUID(),
    symbol,
    name: row.favoriteMeta[symbol].name,
    market,
    source: /** @type {const} */ ("favorite"),
    addedAtMs: row.favoriteMeta[symbol].addedAtMs,
    updatedAtMs: now,
    favoriteAddedAtMs: row.favoriteMeta[symbol].addedAtMs,
    favoritePrice: row.favoriteMeta[symbol].favoritePrice ?? null,
  };
}

/** @deprecated use addUserVaultFavoriteEntrySync */
export function upsertUserManualVaultItemSync(userId, input) {
  return addUserVaultFavoriteEntrySync(userId, input);
}

/**
 * @param {string} userId
 * @param {string} symbol
 */
export function removeUserVaultSymbolSync(userId, symbol) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!uid || !sym) return { removedFavorite: false, dismissed: false };
  const store = readStore();
  const row = ensureUserRow(store, uid);
  const hadFavorite = row.favorites.includes(sym);
  const hadMeta = Boolean(row.favoriteMeta[sym]);
  row.favorites = row.favorites.filter((s) => s !== sym);
  if (hadMeta) delete row.favoriteMeta[sym];
  let dismissed = false;
  if (!hadMeta && !row.dismissed.includes(sym)) {
    row.dismissed.push(sym);
    dismissed = true;
  }
  row.updatedAtMs = Date.now();
  writeStore(store);
  return { removedFavorite: hadFavorite || hadMeta, dismissed };
}

/** @returns {Set<string>} */
export function listAllFavoritedSymbolsSync() {
  const out = new Set();
  for (const row of readStore().users) {
    for (const sym of row.favorites ?? []) {
      const s = String(sym ?? "")
        .trim()
        .toUpperCase();
      if (s) out.add(s);
    }
  }
  return out;
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {boolean} favorited
 * @param {{ name?: string; market?: "kr"|"us"; favoritePrice?: number | null }} [opts]
 */
export function setUserVaultFavoriteSync(userId, symbol, favorited, opts = {}) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!uid || !sym) {
    const err = new Error("symbol required");
    err.code = "INVALID_SYMBOL";
    throw err;
  }
  const now = Date.now();
  const store = readStore();
  const row = ensureUserRow(store, uid);
  const has = row.favorites.includes(sym);
  /** @type {UserFavoriteMeta | null} */
  let meta = null;
  if (favorited) {
    if (!has) row.favorites.push(sym);
    const prev = row.favoriteMeta[sym];
    const market = opts.market === "us" ? "us" : opts.market === "kr" ? "kr" : prev?.market ?? "kr";
    const favoritePrice =
      opts.favoritePrice !== undefined
        ? normFavoritePrice(opts.favoritePrice)
        : (prev?.favoritePrice ?? null);
    meta = {
      name: String(opts.name ?? prev?.name ?? sym).trim() || sym,
      market,
      addedAtMs: prev?.addedAtMs ?? now,
      updatedAtMs: now,
      favoritePrice,
    };
    row.favoriteMeta[sym] = meta;
  } else {
    row.favorites = row.favorites.filter((s) => s !== sym);
    delete row.favoriteMeta[sym];
  }
  row.updatedAtMs = now;
  writeStore(store);
  return { favorited, meta };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {{ favoritePrice?: number | null }} patch
 */
export function patchUserVaultFavoriteMetaSync(userId, symbol, patch) {
  const uid = String(userId ?? "").trim();
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase();
  if (!uid || !sym) {
    const err = new Error("symbol required");
    err.code = "INVALID_SYMBOL";
    throw err;
  }
  const store = readStore();
  const row = ensureUserRow(store, uid);
  if (!row.favorites.includes(sym)) {
    const err = new Error("not favorited");
    err.code = "NOT_FAVORITED";
    throw err;
  }
  const prev = row.favoriteMeta[sym];
  if (!prev) {
    const err = new Error("favorite meta missing");
    err.code = "META_MISSING";
    throw err;
  }
  const now = Date.now();
  const favoritePrice =
    patch.favoritePrice !== undefined
      ? normFavoritePrice(patch.favoritePrice)
      : (prev.favoritePrice ?? null);
  const meta = { ...prev, favoritePrice, updatedAtMs: now };
  row.favoriteMeta[sym] = meta;
  row.updatedAtMs = now;
  writeStore(store);
  return meta;
}
