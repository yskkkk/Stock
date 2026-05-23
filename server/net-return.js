/** 매수·매도 왕복 수수료 기본값 (비율, 0.002 = 0.2%) */
export const DEFAULT_ROUND_TRIP_FEE_RATE = 0.002;

/** @deprecated — DEFAULT_ROUND_TRIP_FEE_RATE 와 동일 */
export const ROUND_TRIP_FEE_RATE = DEFAULT_ROUND_TRIP_FEE_RATE;

/**
 * @param {number} rate
 * @returns {number}
 */
export function normalizeRoundTripFeeRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0 || r >= 0.2) {
    return DEFAULT_ROUND_TRIP_FEE_RATE;
  }
  return r;
}

/**
 * @param {number} bidFee
 * @param {number} askFee
 * @returns {number | null}
 */
export function roundTripFeeRateFromOneWay(bidFee, askFee) {
  const bid = Number(bidFee);
  const ask = Number(askFee);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid < 0 || ask < 0) {
    return null;
  }
  const sum = bid + ask;
  if (sum >= 0.2) return null;
  return sum;
}

/**
 * @param {number} entry
 * @param {number} current
 * @param {number} [roundTripFeeRate]
 * @returns {number}
 */
export function netReturnPct(
  entry,
  current,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  const ratio = current / entry;
  return (ratio * (1 - fee) - 1) * 100;
}

/**
 * @param {number | null} entry
 * @param {number | null} current
 * @param {number} [roundTripFeeRate]
 * @returns {number | null}
 */
export function netReturnPctFromPrices(
  entry,
  current,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
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

/**
 * @param {number} pct
 * @returns {"win"|"loss"|"flat"}
 */
function outcomeFromNetPct(pct) {
  if (Math.abs(pct) < 0.005) return "flat";
  return pct > 0 ? "win" : "loss";
}

/**
 * @param {number | null} entry
 * @param {number | null} current
 * @returns {"win"|"loss"|"flat"|"unknown"}
 */
export function outcomeFromPricesWithFees(
  entry,
  current,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  const pct = netReturnPctFromPrices(entry, current, roundTripFeeRate);
  if (pct == null) return "unknown";
  return outcomeFromNetPct(pct);
}
