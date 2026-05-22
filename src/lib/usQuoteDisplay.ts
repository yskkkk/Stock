import type { Market } from "../types";

export function isUsStockUsdQuote(
  market: Market,
  currency: string | null | undefined,
): boolean {
  if (market !== "us") return false;
  const c = currency?.trim();
  return c == null || c === "" || c === "USD";
}

export function resolveUsQuoteDisplay(
  price: number | null | undefined,
  currency: string | null | undefined,
  market: Market,
  inKrw: boolean,
  rate: number | null,
): {
  price: number | null | undefined;
  currency: string | null | undefined;
  showToggle: boolean;
} {
  const showToggle = isUsStockUsdQuote(market, currency);
  if (
    !showToggle ||
    !inKrw ||
    rate == null ||
    !(rate > 0) ||
    price == null ||
    !Number.isFinite(price)
  ) {
    return { price, currency, showToggle };
  }
  return { price: Math.round(price * rate), currency: "KRW", showToggle };
}
