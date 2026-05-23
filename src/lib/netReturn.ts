/** 매수·매도 왕복 수수료 기본값 (비율, 0.002 = 0.2%) */
export const DEFAULT_ROUND_TRIP_FEE_RATE = 0.002;

/** @deprecated — DEFAULT_ROUND_TRIP_FEE_RATE 와 동일 */
export const ROUND_TRIP_FEE_RATE = DEFAULT_ROUND_TRIP_FEE_RATE;

export function normalizeRoundTripFeeRate(rate: number): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0 || r >= 0.2) {
    return DEFAULT_ROUND_TRIP_FEE_RATE;
  }
  return r;
}

export function grossReturnPct(entry: number, current: number): number {
  return ((current - entry) / entry) * 100;
}

/** 왕복 수수료를 반영한 순수익률(%) */
export function netReturnPct(
  entry: number,
  current: number,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): number {
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  const ratio = current / entry;
  return ratio * (1 - fee) * 100 - 100;
}

export function netReturnPctFromPrices(
  entry: number | null | undefined,
  current: number | null | undefined,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
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
  return netReturnPct(entry, current, roundTripFeeRate);
}

export type ReturnOutcome = "win" | "loss" | "flat";

export function outcomeFromNetPct(pct: number): ReturnOutcome {
  if (Math.abs(pct) < 0.005) return "flat";
  return pct > 0 ? "win" : "loss";
}

export function outcomeFromPricesWithFees(
  entry: number | null | undefined,
  current: number | null | undefined,
  roundTripFeeRate: number = DEFAULT_ROUND_TRIP_FEE_RATE,
): "win" | "loss" | "flat" | "unknown" {
  const pct = netReturnPctFromPrices(entry, current, roundTripFeeRate);
  if (pct == null) return "unknown";
  return outcomeFromNetPct(pct);
}
