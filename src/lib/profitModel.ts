/**
 * 가정 매수가(entry) 대비 현재가 기준 손익
 */
export function computeProfitFromEntry(
  current: number | undefined | null,
  entry: number | null,
): { abs: number; pct: number } | null {
  if (entry == null || !(entry > 0)) return null;
  if (current == null || !Number.isFinite(current)) return null;
  const abs = current - entry;
  const pct = (abs / entry) * 100;
  return { abs, pct };
}
