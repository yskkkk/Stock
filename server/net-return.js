/** 매수·매도 왕복 수수료 (비율, 0.002 = 0.2%) */
export const ROUND_TRIP_FEE_RATE = 0.002;

/**
 * @param {number} entry
 * @param {number} current
 * @returns {number}
 */
export function netReturnPct(entry, current) {
  const ratio = current / entry;
  return (ratio * (1 - ROUND_TRIP_FEE_RATE) - 1) * 100;
}

/**
 * @param {number | null} entry
 * @param {number | null} current
 * @returns {number | null}
 */
export function netReturnPctFromPrices(entry, current) {
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
export function outcomeFromPricesWithFees(entry, current) {
  const pct = netReturnPctFromPrices(entry, current);
  if (pct == null) return "unknown";
  return outcomeFromNetPct(pct);
}
