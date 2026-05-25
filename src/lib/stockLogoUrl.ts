import type { Market } from "../types";

/** 국내 종목 로고(Naver). 실패 시 UI에서 이니셜 폴백. */
export function krStockLogoUrl(symbol: string): string | null {
  const code = symbol.replace(/^KR_/i, "").replace(/\.(KS|KQ)$/i, "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  return `https://ssl.pstatic.net/imgstock/item_logo/${code}.png`;
}

/** 미국 티커 로고(FMP). 실패 시 UI 이니셜 폴백. */
export function usStockLogoUrl(symbol: string): string | null {
  const ticker = symbol.replace(/^US_/i, "").trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) return null;
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
}

export function stockLogoUrl(symbol: string, market: Market): string | null {
  if (market === "kr") return krStockLogoUrl(symbol);
  if (market === "us") return usStockLogoUrl(symbol);
  const ticker = symbol.replace(/^US_/i, "").trim().toUpperCase();
  if (!ticker || ticker.length > 8) return null;
  return usStockLogoUrl(ticker);
}
