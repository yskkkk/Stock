import type { LiveTradeHolding, TossTestHolding } from "../api";
import { TOSS_FIXED_ROUND_TRIP_FEE_RATE } from "./netReturn";
import {
  tossHoldingNetReturnPercent,
  tossHoldingNetUnrealizedPnl,
} from "./tossHoldingPnl";

/** 토스 보유 스냅샷 → 거래내역 탭 보유 테이블 */
export function mapTossHoldingsToLiveTrade(
  holdings: TossTestHolding[],
): LiveTradeHolding[] {
  return holdings.map((h) => {
    const avg = h.avgBuyPrice ?? 0;
    const costBasis = avg > 0 ? avg * h.quantity : 0;
    const mv =
      h.marketValue ??
      (h.currentPrice != null && h.currentPrice > 0
        ? h.currentPrice * h.quantity
        : null);
    const fee = TOSS_FIXED_ROUND_TRIP_FEE_RATE;
    const unreal = tossHoldingNetUnrealizedPnl(h, fee);
    const netReturn = tossHoldingNetReturnPercent(h, fee);
    return {
      programId: "toss-account",
      programName: "토스",
      symbol: h.symbol,
      name: h.name,
      market: h.market,
      quantity: h.quantity,
      avgEntryPrice: avg,
      costBasis,
      currency: h.currency,
      currentPrice: h.currentPrice ?? null,
      marketValue: mv,
      unrealizedPnl: unreal,
      grossChangePct: h.returnPercent ?? h.dailyChangePercent ?? null,
      changePct: netReturn ?? h.returnPercent ?? h.dailyChangePercent ?? null,
      targetSellPrice: null,
      stopLossPrice: null,
      openedAtMs: null,
      lastAtMs: null,
    };
  });
}
