/**
 * 실매매·시뮬 체결가 — 요청 시점 1분봉 종가와 봉 시각을 함께 반환.
 */
import { loadChartQuoteSnapshot1m } from "./stock-data.js";

/**
 * @param {string} symbol
 * @returns {Promise<{ symbol: string; price: number; atMs: number; changePercent?: number }>}
 */
export async function resolveLiveTradeQuote(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) throw new Error("종목 코드가 필요합니다.");
  const snap = await loadChartQuoteSnapshot1m(sym);
  const price = snap?.price;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    throw new Error(`실시간 시세를 가져올 수 없습니다: ${sym}`);
  }
  const atMs =
    typeof snap.quotedAtMs === "number" && snap.quotedAtMs > 0
      ? snap.quotedAtMs
      : Date.now();
  return {
    symbol: sym,
    price,
    atMs,
    changePercent:
      typeof snap.changePercent === "number" && Number.isFinite(snap.changePercent)
        ? snap.changePercent
        : undefined,
  };
}
