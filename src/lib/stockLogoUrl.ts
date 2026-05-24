import type { Market } from "../types";

/** 국내 종목 로고(Naver). 실패 시 UI에서 이니셜 폴백. */
export function krStockLogoUrl(symbol: string): string | null {
  const code = symbol.replace(/^KR_/i, "").replace(/\.(KS|KQ)$/i, "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  return `https://ssl.pstatic.net/imgstock/item_logo/${code}.png`;
}

export function stockLogoUrl(symbol: string, market: Market): string | null {
  if (market === "kr") return krStockLogoUrl(symbol);
  const ticker = symbol.replace(/^US_/i, "").trim().toUpperCase();
  if (!ticker || ticker.length > 8) return null;
  return null;
}
