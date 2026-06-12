/** 지정가 입력 — 0 포함 숫자·소수 허용, 빈칸·NaN은 null */
export function parseLimitPriceInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function limitPriceDeviationPct(
  limitPrice: number,
  currentPrice: number,
): number | null {
  if (
    !Number.isFinite(limitPrice) ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return null;
  }
  return (Math.abs(limitPrice - currentPrice) / currentPrice) * 100;
}

export function formatLimitPriceSeed(price: number, market: "kr" | "us"): string {
  if (!Number.isFinite(price) || price < 0) return "";
  if (market === "kr") return String(Math.round(price));
  if (price === 0) return "0";
  return price.toFixed(2).replace(/\.?0+$/, "");
}
