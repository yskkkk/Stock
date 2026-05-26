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

/** 매입 원가·평가금액 기준 총수익률(%) — 평단·24h 등락과 어긋나지 않게 */
export function holdingGrossReturnPctFromCost(costBasis, marketValue) {
  const cost = Number(costBasis);
  const mv = Number(marketValue);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(mv) || mv <= 0) return null;
  return ((mv - cost) / cost) * 100;
}

/** 매입 원가 대비 매도 수수료 반영 순평가 수익률(%) */
export function holdingNetReturnPctFromCost(
  costBasis,
  marketValue,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  const cost = Number(costBasis);
  const mv = Number(marketValue);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(mv) || mv <= 0) return null;
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  const netMv = mv * (1 - fee / 2);
  return ((netMv - cost) / cost) * 100;
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
