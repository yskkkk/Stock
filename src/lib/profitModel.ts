/**
 * 가정 매수가(entry) 대비 손익.
 * `exit`가 있으면 청산가 기준(실현), 없으면 `current` 기준(평가).
 */
export function computeProfitFromEntry(
  current: number | undefined | null,
  entry: number | null,
  exit?: number | null,
): { abs: number; pct: number; closed: boolean } | null {
  if (entry == null || !(entry > 0)) return null;
  const ref =
    exit != null && Number.isFinite(exit) && exit > 0 ? exit : current;
  if (ref == null || !Number.isFinite(ref)) return null;
  const abs = ref - entry;
  const pct = (abs / entry) * 100;
  return {
    abs,
    pct,
    closed: exit != null && Number.isFinite(exit) && exit > 0,
  };
}
