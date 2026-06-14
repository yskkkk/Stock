/** 종목보관 — 메모리·네트워크 절약용 상수·유틸 */

import type { StockVaultFavoriteMeta, StockVaultItem } from "../types";

export const VAULT_LIST_INITIAL_ROWS = 12;
export const VAULT_LIST_ROW_STEP = 12;
export const VAULT_QUOTE_BATCH_SIZE = 8;
export const VAULT_QUOTE_DRAIN_MS = 900;
export const VAULT_CHART_INSIGHT_SYMBOL_BATCH = 40;
export const VAULT_INDUSTRY_FIN_BATCH = 120;

export type VaultQuoteRow = {
  price: number;
  changePercent?: number;
  currency?: string;
};

export function uniqueVaultSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

export function pickQuoteBatch(
  symbols: string[],
  batchIndex: number,
  size = VAULT_QUOTE_BATCH_SIZE,
): string[] {
  const uniq = uniqueVaultSymbols(symbols);
  if (!uniq.length) return [];
  if (uniq.length <= size) return uniq;
  const start = (batchIndex * size) % uniq.length;
  const batch: string[] = [];
  for (let i = 0; i < size; i += 1) {
    batch.push(uniq[(start + i) % uniq.length]!);
  }
  return batch;
}

export function symbolsMissingQuotes(
  symbols: string[],
  quotes: Record<string, VaultQuoteRow | undefined>,
): string[] {
  return uniqueVaultSymbols(symbols).filter((sym) => {
    const q = quotes[sym];
    return !q?.price || !Number.isFinite(q.price);
  });
}

export function mergeVaultQuotePatch(
  prev: Record<string, VaultQuoteRow>,
  incoming: Record<string, Partial<VaultQuoteRow> | undefined> | undefined,
  keepSymbols: Iterable<string>,
): Record<string, VaultQuoteRow> {
  const entries = Object.entries(incoming ?? {});
  if (!entries.length) return prev;
  let changed = false;
  const next = { ...prev };
  for (const [sym, q] of entries) {
    if (!q?.price || !Number.isFinite(q.price)) continue;
    const key = sym.trim().toUpperCase();
    const row: VaultQuoteRow = {
      price: q.price,
      changePercent: q.changePercent,
      currency: q.currency,
    };
    const old = prev[key];
    if (
      old?.price === row.price &&
      old?.changePercent === row.changePercent &&
      old?.currency === row.currency
    ) {
      continue;
    }
    next[key] = row;
    changed = true;
  }
  if (!changed) return prev;
  return pruneSymbolRecord(next, keepSymbols);
}

export function pruneSymbolRecord<T>(
  map: Record<string, T>,
  keepSymbols: Iterable<string>,
): Record<string, T> {
  const keep = new Set(uniqueVaultSymbols([...keepSymbols]));
  if (!keep.size) return {};
  let changed = false;
  const out: Record<string, T> = {};
  for (const sym of keep) {
    const row = map[sym];
    if (row !== undefined) out[sym] = row;
    else changed = true;
  }
  if (!changed && Object.keys(map).length === keep.size) return map;
  return out;
}

/** favoriteMeta 기준으로 스냅샷·로컬 목록 favorited 보강 (해제는 patchVaultItemFavorite) */
export function overlayVaultFavoriteState(
  items: StockVaultItem[],
  favoriteMeta: Record<string, StockVaultFavoriteMeta>,
): StockVaultItem[] {
  if (!items.length || !Object.keys(favoriteMeta).length) return items;

  let changed = false;
  const out = items.map((it) => {
    const sym = it.symbol.trim().toUpperCase();
    const fm = favoriteMeta[sym];
    if (!fm) return it;
    if (
      it.favorited &&
      it.favoriteAddedAtMs === fm.addedAtMs &&
      (it.favoritePrice ?? null) === (fm.favoritePrice ?? null)
    ) {
      return it;
    }
    changed = true;
    return {
      ...it,
      favorited: true,
      favoriteAddedAtMs: fm.addedAtMs,
      favoritePrice: fm.favoritePrice ?? null,
    };
  });
  return changed ? out : items;
}

export function patchVaultItemFavorite(
  items: StockVaultItem[],
  symbol: string,
  favorited: boolean,
  meta: StockVaultFavoriteMeta | null,
): StockVaultItem[] {
  const sym = symbol.trim().toUpperCase();
  return items.map((it) => {
    if (it.symbol.trim().toUpperCase() !== sym) return it;
    if (favorited) {
      return {
        ...it,
        favorited: true,
        favoriteAddedAtMs: meta?.addedAtMs ?? it.favoriteAddedAtMs ?? Date.now(),
        favoritePrice: meta?.favoritePrice ?? it.favoritePrice ?? null,
      };
    }
    return {
      ...it,
      favorited: false,
      favoriteAddedAtMs: null,
      favoritePrice: null,
    };
  });
}
