/** 종목보관 — 메모리·네트워크 절약용 상수·유틸 */

export const VAULT_LIST_INITIAL_ROWS = 24;
export const VAULT_LIST_ROW_STEP = 24;
export const VAULT_QUOTE_BATCH_SIZE = 10;
export const VAULT_QUOTE_DRAIN_MS = 650;
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
