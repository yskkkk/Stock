import {
  isCryptoUsdtSymbol,
  loadBithumbKrwQuotesBatch,
} from "./bithumb-krw.js";
import { loadChartQuoteSnapshot } from "./stock-data.js";

const DEFAULT_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT"];

/**
 * 여러 코인 시세 — USDT 키(앱 심볼)는 빗썸 KRW 공개 API, 그 외는 v8 차트 스냅샷(Yahoo).
 */
export async function loadCryptoQuotes(symbols = DEFAULT_SYMBOLS) {
  const list = (symbols.length ? symbols : DEFAULT_SYMBOLS).map((s) =>
    String(s).trim().toUpperCase(),
  );
  const uniq = [...new Set(list)].filter(Boolean);
  if (uniq.length === 0) return { quotes: {}, updatedAt: Date.now() };

  if (uniq.every(isCryptoUsdtSymbol)) {
    return loadBithumbKrwQuotesBatch(uniq);
  }

  const rows = await Promise.all(
    uniq.map(async (sym) => {
      const q = await loadChartQuoteSnapshot(sym);
      return [sym, q];
    }),
  );

  const quotes = {};
  for (const [sym, q] of rows) {
    if (q) quotes[sym] = { ...q, symbol: sym };
  }
  return { quotes, updatedAt: Date.now() };
}
