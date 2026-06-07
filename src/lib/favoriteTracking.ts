/** KST 달력일 기준 D+N (당일 = 0) */
export function favoriteDPlusDays(
  addedAtMs: number,
  nowMs: number = Date.now(),
): number | null {
  const startMs = Number(addedAtMs);
  if (!Number.isFinite(startMs) || startMs <= 0) return null;
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
      new Date(ms),
    );
  const start = new Date(`${fmt(startMs)}T00:00:00+09:00`).getTime();
  const end = new Date(`${fmt(nowMs)}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

export function favoriteChangePercent(
  current: number | null | undefined,
  base: number | null | undefined,
): number | null {
  if (current == null || base == null) return null;
  const cur = Number(current);
  const b = Number(base);
  if (!Number.isFinite(cur) || !Number.isFinite(b) || b <= 0) return null;
  return ((cur - b) / b) * 100;
}

export function formatFavoriteDPlus(days: number | null): string {
  if (days == null || !Number.isFinite(days) || days < 0) return "—";
  return `D+${days}`;
}
