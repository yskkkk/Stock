/**
 * 실거래·시뮬 — 코인 종목 검색 (빗썸 KRW 유니버스)
 */
import { loadCryptoWatchlistTen } from "./crypto-universe.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";

/**
 * @param {string} q
 * @returns {Promise<{ quotes: object[] }>}
 */
export async function searchCryptoForLiveTrade(q) {
  const term = String(q ?? "").trim().toLowerCase();
  if (!term) return { quotes: [] };

  const { assets } = await loadCryptoWatchlistTen();
  const hits = assets
    .filter((a) => {
      const sym = a.symbol.toLowerCase();
      const base = sym.replace(/-usdt$/i, "");
      const name = String(a.name ?? "").toLowerCase();
      return (
        sym.includes(term) ||
        base.includes(term) ||
        name.includes(term)
      );
    })
    .slice(0, 12);

  const symbols = hits.map((a) => a.symbol);
  const quotes =
    symbols.length > 0
      ? await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 })
      : {};

  return {
    quotes: hits.map((a) => {
      const qrow = quotes[a.symbol];
      return {
        symbol: a.symbol,
        name: a.name,
        market: "crypto",
        price:
          qrow?.price != null && Number.isFinite(qrow.price) ? qrow.price : undefined,
        changePercent:
          typeof qrow?.changePercent === "number" && Number.isFinite(qrow.changePercent)
            ? qrow.changePercent
            : undefined,
        currency: "KRW",
        quoteTurnoverKrw: a.quoteTurnoverKrw,
      };
    }),
  };
}
