import { formatPercent, formatPrice } from "./format";
import type { MarketIndexItem } from "../types";

export function formatMarketIndexPrice(item: MarketIndexItem): string {
  const value = item.price;
  if (value == null || !Number.isFinite(value)) return "—";
  if (item.kind === "fx") {
    return formatPrice(value, "KRW");
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

export function marketIndexChangeTone(
  item: MarketIndexItem,
): "up" | "down" | "muted" {
  const pct = item.changePercent;
  if (pct == null || !Number.isFinite(pct)) return "muted";
  return pct >= 0 ? "up" : "down";
}

export function formatMarketIndexChange(item: MarketIndexItem): string {
  const pct = item.changePercent;
  if (pct == null || !Number.isFinite(pct)) return "—";
  return formatPercent(pct);
}
