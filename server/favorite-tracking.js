/** @param {number | Date} [now] @returns {string} YYYY-MM-DD KST */
export function kstDateKey(now = Date.now()) {
  const ms = now instanceof Date ? now.getTime() : Number(now);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(ms),
  );
}

/**
 * 즐겨찾기 등록일(KST) 기준 경과 일수 — 당일 D+0
 * @param {number} addedAtMs
 * @param {number | Date} [now]
 */
export function favoriteDPlusDays(addedAtMs, now = Date.now()) {
  const startMs = Number(addedAtMs);
  if (!Number.isFinite(startMs) || startMs <= 0) return null;
  const startKey = kstDateKey(startMs);
  const endKey = kstDateKey(now);
  const start = new Date(`${startKey}T00:00:00+09:00`).getTime();
  const end = new Date(`${endKey}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * @param {number | null | undefined} current
 * @param {number | null | undefined} base
 */
export function favoriteChangePercent(current, base) {
  if (current == null || base == null) return null;
  const cur = Number(current);
  const b = Number(base);
  if (!Number.isFinite(cur) || !Number.isFinite(b) || b <= 0) return null;
  return ((cur - b) / b) * 100;
}
