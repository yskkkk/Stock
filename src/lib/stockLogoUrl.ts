import type { Market } from "../types";

const FMP_LOGO_BASE = "https://financialmodelingprep.com/image-stock";

/** @returns e.g. 005930.KS */
export function krStockLogoTicker(symbol: string): string | null {
  const s = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/^KR_/, "");
  const m = s.match(/^(\d{6})(\.(KS|KQ))?$/);
  if (!m) return null;
  return `${m[1]}.${m[3] ?? "KS"}`;
}

/** 국내 종목 로고(FMP · Yahoo 티커 형식). 실패 시 UI에서 이니셜 폴백. */
export function krStockLogoUrl(symbol: string): string | null {
  const ticker = krStockLogoTicker(symbol);
  if (!ticker) return null;
  return `${FMP_LOGO_BASE}/${encodeURIComponent(ticker)}.png`;
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
