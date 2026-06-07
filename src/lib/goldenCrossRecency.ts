export type GoldenCrossRecencyTier = "recent-3" | "recent-6" | "recent-10";

export function resolveGoldenCrossDate(item: {
  crossDate?: string | null;
  scanDate?: string | null;
}): string | null {
  const cross = String(item.crossDate ?? "").trim();
  if (cross) return cross;
  const scan = String(item.scanDate ?? "").trim();
  return scan || null;
}

/** KST 기준 crossDate(YYYY-MM-DD)로부터 경과 일수 */
export function goldenCrossDaysSince(
  dateKey: string,
  now: Date = new Date(),
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return Number.POSITIVE_INFINITY;
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(now);
  const crossMs = Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`);
  const todayMs = Date.parse(`${todayKey}T12:00:00+09:00`);
  if (!Number.isFinite(crossMs) || !Number.isFinite(todayMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((todayMs - crossMs) / 86_400_000);
}

/** 1~3·4~6·7~10일 — 10일 초과는 null */
export function goldenCrossRecencyTier(
  daysSince: number,
): GoldenCrossRecencyTier | null {
  if (!Number.isFinite(daysSince) || daysSince < 0) return "recent-3";
  if (daysSince <= 3) return "recent-3";
  if (daysSince <= 6) return "recent-6";
  if (daysSince <= 10) return "recent-10";
  return null;
}

export function goldenCrossRecencyClass(
  item: { crossDate?: string | null; scanDate?: string | null },
  now?: Date,
): string | null {
  const dateKey = resolveGoldenCrossDate(item);
  if (!dateKey) return null;
  const tier = goldenCrossRecencyTier(goldenCrossDaysSince(dateKey, now));
  return tier ? `stock-vault-tab__row--gc-${tier}` : null;
}

export function sortGoldenCrossItems<
  T extends {
    crossDate?: string | null;
    scanDate?: string | null;
    updatedAtMs?: number;
  },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = resolveGoldenCrossDate(a);
    const db = resolveGoldenCrossDate(b);
    if (da && db && da !== db) return db.localeCompare(da);
    if (da && !db) return -1;
    if (!da && db) return 1;
    return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
  });
}
