export type WeeklyMaProximityHit = {
  period: number;
  ma: number;
  diffPct: number;
  side: "above" | "below";
};

export type WeeklyMaProximitySnapshot = {
  near: WeeklyMaProximityHit[];
  updatedAtMs?: number;
};

export function weeklyMaProximityBadgeClass(period: number): string {
  if (period === 20) return "stock-vault-tab__ma-near--20";
  if (period === 60) return "stock-vault-tab__ma-near--60";
  return "stock-vault-tab__ma-near--120";
}

export function weeklyMaProximityPriceClass(
  hits: WeeklyMaProximityHit[] | undefined,
): string | null {
  if (!hits?.length) return null;
  const closest = [...hits].sort((a, b) => a.diffPct - b.diffPct)[0];
  if (closest.period === 20) return "stock-vault-tab__price--wk-ma-20";
  if (closest.period === 60) return "stock-vault-tab__price--wk-ma-60";
  return "stock-vault-tab__price--wk-ma-120";
}

export function formatWeeklyMaProximityLabel(
  period: number,
  labels: { near: (p: number) => string },
): string {
  return labels.near(period);
}
