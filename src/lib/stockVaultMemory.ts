/** 종목보관 — 메모리·네트워크 절약용 상수·유틸 */

export const VAULT_LIST_INITIAL_ROWS = 60;
export const VAULT_LIST_ROW_STEP = 60;
export const VAULT_QUOTE_BATCH_SIZE = 48;
export const VAULT_CHART_INSIGHT_SYMBOL_BATCH = 80;
export const VAULT_INDUSTRY_FIN_BATCH = 120;

export function uniqueVaultSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
}

export function pickQuoteBatch(symbols: string[], batchIndex: number, size = VAULT_QUOTE_BATCH_SIZE): string[] {
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
