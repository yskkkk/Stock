import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
} from "./net-return.js";

/**
 * 수수료 반영 순수익률이 takeProfitPct에 도달하는 매도가
 * @param {number} entryPrice
 * @param {number} takeProfitPct
 * @param {number} [roundTripFeeRate]
 */
export function targetSellPriceFromTakeProfit(
  entryPrice,
  takeProfitPct,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  const entry = Number(entryPrice);
  const pct = Number(takeProfitPct);
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const mult = (1 + pct / 100) / (1 - fee);
  return entry * mult;
}

/**
 * @param {number} entryPrice
 * @param {number} stopLossPct — 음수 예: -3
 * @param {number} [roundTripFeeRate]
 */
export function stopLossPriceFromPct(
  entryPrice,
  stopLossPct,
  roundTripFeeRate = DEFAULT_ROUND_TRIP_FEE_RATE,
) {
  const entry = Number(entryPrice);
  const pct = Number(stopLossPct);
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(pct) || pct >= 0) return null;
  const mult = (1 + pct / 100) / (1 - fee);
  return entry * mult;
}

/** @deprecated 고정 % — 신규 매수는 live-trade-exit-scenario 사용 */
export function sellTargetsForProgram(program, entryPrice) {
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) {
    return { targetSellPrice: null, stopLossPrice: null };
  }
  const tp = program.takeProfitPct;
  const sl = program.stopLossPct;
  if (tp == null && sl == null) {
    return { targetSellPrice: null, stopLossPrice: null };
  }
  return {
    targetSellPrice:
      tp != null && Number.isFinite(Number(tp)) && Number(tp) > 0
        ? targetSellPriceFromTakeProfit(entry, Number(tp))
        : null,
    stopLossPrice:
      sl != null && Number.isFinite(Number(sl)) && Number(sl) < 0
        ? stopLossPriceFromPct(entry, Number(sl))
        : null,
  };
}
