import type {
  StockVaultChartInsightSnapshot,
  StockVaultMaProximityHit,
  StockVaultTimeframeChartInsight,
  StockVaultTrend,
} from "../types";

export function maProximityBadgeClass(period: number): string {
  if (period === 20) return "stock-vault-tab__ma-near--20";
  if (period === 60) return "stock-vault-tab__ma-near--60";
  return "stock-vault-tab__ma-near--120";
}

export function maProximityPriceClass(
  hits: StockVaultMaProximityHit[] | undefined,
): string | null {
  if (!hits?.length) return null;
  const closest = [...hits].sort((a, b) => a.diffPct - b.diffPct)[0];
  if (closest.period === 20) return "stock-vault-tab__price--wk-ma-20";
  if (closest.period === 60) return "stock-vault-tab__price--wk-ma-60";
  return "stock-vault-tab__price--wk-ma-120";
}

export function trendBadgeClass(trend: StockVaultTrend): string {
  if (trend === "up") return "stock-vault-tab__trend--up";
  if (trend === "down") return "stock-vault-tab__trend--down";
  return "stock-vault-tab__trend--neutral";
}

export function formatTrendLabel(
  timeframe: "daily" | "weekly",
  trend: StockVaultTrend,
  labels: {
    dailyUp: string;
    dailyDown: string;
    dailyNeutral: string;
    weeklyUp: string;
    weeklyDown: string;
    weeklyNeutral: string;
  },
): string {
  if (timeframe === "daily") {
    if (trend === "up") return labels.dailyUp;
    if (trend === "down") return labels.dailyDown;
    return labels.dailyNeutral;
  }
  if (trend === "up") return labels.weeklyUp;
  if (trend === "down") return labels.weeklyDown;
  return labels.weeklyNeutral;
}

export function formatMaNearLabel(
  timeframe: "daily" | "weekly",
  period: number,
  labels: { dailyNear: (p: number) => string; weeklyNear: (p: number) => string },
): string {
  return timeframe === "daily"
    ? labels.dailyNear(period)
    : labels.weeklyNear(period);
}

export function formatMaApproachLabel(
  approach: StockVaultMaProximityHit["approach"],
  labels: { fromBelow: string; fromAbove: string; flat: string },
): string | null {
  if (approach === "from_below") return labels.fromBelow;
  if (approach === "from_above") return labels.fromAbove;
  return approach === "flat" ? labels.flat : null;
}

export function pickChartInsight(
  map: Record<string, StockVaultChartInsightSnapshot> | undefined,
  symbol: string,
): StockVaultChartInsightSnapshot | null {
  const key = symbol.trim().toUpperCase();
  return map?.[key] ?? null;
}

export function allMaNearHits(
  insight: StockVaultTimeframeChartInsight | null | undefined,
): StockVaultMaProximityHit[] {
  return insight?.near ?? [];
}
