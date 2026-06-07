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
    out[symbol] = { name, market, addedAtMs, updatedAtMs };
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
 * @param {{ symbol: string; name?: string; market: "kr"|"us" }} input
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
  row.favoriteMeta[symbol] = {
    name: String(input.name ?? prev?.name ?? symbol).trim() || symbol,
    market,
    addedAtMs: prev?.addedAtMs ?? now,
    updatedAtMs: now,
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

export function setUserVaultFavoriteSync(userId, symbol, favorited) {
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
  const has = row.favorites.includes(sym);
  if (favorited) {
    if (!has) row.favorites.push(sym);
  } else {
    row.favorites = row.favorites.filter((s) => s !== sym);
    delete row.favoriteMeta[sym];
  }
  row.updatedAtMs = Date.now();
  writeStore(store);
  return favorited;
}
