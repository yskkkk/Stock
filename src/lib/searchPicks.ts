import type { StockPick } from "../types";

export function filterPicksByQuery(picks: StockPick[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return picks;
  return picks.filter((p) => {
    const sym = p.symbol.toLowerCase();
    const name = p.name.toLowerCase();
    const code = sym.replace(/\.(ks|kq)$/i, "");
    return name.includes(q) || sym.includes(q) || code.includes(q);
  });
}
