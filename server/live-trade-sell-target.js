import { ROUND_TRIP_FEE_RATE } from "./net-return.js";

/**
 * 수수료 반영 순수익률이 takeProfitPct에 도달하는 매도가
 * @param {number} entryPrice
 * @param {number} takeProfitPct
 */
export function targetSellPriceFromTakeProfit(entryPrice, takeProfitPct) {
  const entry = Number(entryPrice);
  const pct = Number(takeProfitPct);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const mult = (1 + pct / 100) / (1 - ROUND_TRIP_FEE_RATE);
  return entry * mult;
}

/**
 * @param {number} entryPrice
 * @param {number} stopLossPct — 음수 예: -3
 */
export function stopLossPriceFromPct(entryPrice, stopLossPct) {
  const entry = Number(entryPrice);
  const pct = Number(stopLossPct);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(pct) || pct >= 0) return null;
  const mult = (1 + pct / 100) / (1 - ROUND_TRIP_FEE_RATE);
  return entry * mult;
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {number} entryPrice
 */
export function sellTargetsForProgram(program, entryPrice) {
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) {
    return { targetSellPrice: null, stopLossPrice: null };
  }
  const tp = program.takeProfitPct;
  const sl = program.stopLossPct;
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
