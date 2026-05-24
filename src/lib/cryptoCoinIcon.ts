import type { LiveTradeMarket } from "../types";

/** cryptocurrency-icons(slug)에 없는 심볼 */
const SLUG_ALIASES: Record<string, string> = {
  WLD: "wld",
};

/** BTC-USDT · ETH-USDT → btc */
export function cryptoIconSlug(
  symbol: string,
  market?: LiveTradeMarket | "crypto" | "kr" | "us",
): string | null {
  if (market != null && market !== "crypto") return null;
  const up = String(symbol ?? "").trim().toUpperCase();
  if (!up) return null;
  let base = up;
  if (base.endsWith("-USDT")) base = base.slice(0, -5);
  else if (base.endsWith("-USD")) base = base.slice(0, -4);
  else if (base.includes(".")) return null;
  if (!/^[A-Z0-9]{1,12}$/.test(base)) return null;
  return (SLUG_ALIASES[base] ?? base).toLowerCase();
}

export function cryptoCoinIconUrl(slug: string): string {
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${encodeURIComponent(slug)}.png`;
}
