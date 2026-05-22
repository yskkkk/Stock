/** 매수·매도 왕복 수수료 (비율, 0.002 = 0.2%) */
export const ROUND_TRIP_FEE_RATE = 0.002;

export function grossReturnPct(entry: number, current: number): number {
  return ((current - entry) / entry) * 100;
}

/** 왕복 수수료를 반영한 순수익률(%) */
export function netReturnPct(entry: number, current: number): number {
  const ratio = current / entry;
  return (ratio * (1 - ROUND_TRIP_FEE_RATE) - 1) * 100;
}

export function netReturnPctFromPrices(
  entry: number | null | undefined,
  current: number | null | undefined,
): number | null {
  if (
    entry == null ||
    current == null ||
    !Number.isFinite(entry) ||
    !Number.isFinite(current) ||
    entry <= 0
  ) {
    return null;
  }
  return netReturnPct(entry, current);
}

export type ReturnOutcome = "win" | "loss" | "flat";

export function outcomeFromNetPct(pct: number): ReturnOutcome {
  if (Math.abs(pct) < 0.005) return "flat";
  return pct > 0 ? "win" : "loss";
}

export function outcomeFromPricesWithFees(
  entry: number | null | undefined,
  current: number | null | undefined,
): "win" | "loss" | "flat" | "unknown" {
  const pct = netReturnPctFromPrices(entry, current);
  if (pct == null) return "unknown";
  return outcomeFromNetPct(pct);
}
