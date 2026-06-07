import { randomUUID } from "node:crypto";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

function userVaultStoreFile() {
  return process.env.USER_STOCK_VAULT_STORE_TEST_FILE?.trim() || "user-stock-vault.json";
}

/**
 * @typedef {import("./stock-vault-store.js").StockVaultItem} StockVaultItem
 */

/**
 * @typedef {{
 *   userId: string;
 *   manualItems: StockVaultItem[];
 *   favorites: string[];
 *   dismissed: string[];
 *   updatedAtMs: number;
 * }} UserStockVaultRow
 */

/** @typedef {{ version: 1; users: UserStockVaultRow[] }} UserStockVaultStore */

/** @param {unknown} raw */
function normalizeItem(row) {
  const symbol = String(row?.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return null;
  const market = row?.market === "us" ? "us" : "kr";
  return {
    id: String(row?.id ?? randomUUID()),
    symbol,
    name: String(row?.name ?? symbol).trim() || symbol,
    market,
    source: /** @type {const} */ ("manual"),
    addedAtMs:
      typeof row?.addedAtMs === "number" && Number.isFinite(row.addedAtMs)
        ? row.addedAtMs
        : Date.now(),
    updatedAtMs:
      typeof row?.updatedAtMs === "number" && Number.isFinite(row.updatedAtMs)
        ? row.updatedAtMs
        : Date.now(),
  };
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  const users = Array.isArray(raw?.users) ? raw.users : [];
  /** @type {UserStockVaultRow[]} */
  const out = [];
  for (const row of users) {
    const userId = String(row?.userId ?? "").trim();
    if (!userId) continue;
    const manualItems = [];
    const seen = new Set();
    for (const item of Array.isArray(row?.manualItems) ? row.manualItems : []) {
      const norm = normalizeItem(item);
      if (!norm || seen.has(norm.symbol)) continue;
      manualItems.push(norm);
      seen.add(norm.symbol);
    }
    manualItems.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    const normSymbols = (arr) =>
      [
        ...new Set(
          (Array.isArray(arr) ? arr : [])
            .map((s) => String(s ?? "").trim().toUpperCase())
            .filter(Boolean),
        ),
      ];
    out.push({
      userId,
      manualItems,
      favorites: normSymbols(row?.favorites),
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
      manualItems: [],
      favorites: [],
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
      manualItems: [],
      favorites: [],
      dismissed: [],
      updatedAtMs: Date.now(),
    }
  );
}

/**
 * @param {string} userId
 * @param {{ symbol: string; name?: string; market: "kr"|"us" }} input
 */
export function upsertUserManualVaultItemSync(userId, input) {
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
  const idx = row.manualItems.findIndex((it) => it.symbol === symbol);
  if (idx >= 0) {
    const prev = row.manualItems[idx];
    row.manualItems[idx] = {
      ...prev,
      name: String(input.name ?? prev.name).trim() || prev.name,
      market,
      updatedAtMs: now,
    };
  } else {
    row.manualItems.unshift({
      id: randomUUID(),
      symbol,
      name: String(input.name ?? symbol).trim() || symbol,
      market,
      source: "manual",
      addedAtMs: now,
      updatedAtMs: now,
    });
  }
  row.dismissed = row.dismissed.filter((s) => s !== symbol);
  row.updatedAtMs = now;
  writeStore(store);
  return row.manualItems.find((it) => it.symbol === symbol) ?? null;
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
  if (!uid || !sym) return { removedManual: false, dismissed: false };
  const store = readStore();
  const row = ensureUserRow(store, uid);
  const beforeManual = row.manualItems.length;
  row.manualItems = row.manualItems.filter((it) => it.symbol !== sym);
  const removedManual = row.manualItems.length < beforeManual;
  if (removedManual) {
    row.favorites = row.favorites.filter((s) => s !== sym);
  } else if (!row.dismissed.includes(sym)) {
    row.dismissed.push(sym);
  }
  row.updatedAtMs = Date.now();
  writeStore(store);
  return { removedManual, dismissed: !removedManual };
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {boolean} favorited
 */
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
  }
  row.updatedAtMs = Date.now();
  writeStore(store);
  return favorited;
}
