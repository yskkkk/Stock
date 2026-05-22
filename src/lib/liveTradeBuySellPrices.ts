import type { LiveTradeRecord } from "../api";

export type TradeFillDisplay = {
  buyPrice: number | null;
  sellPrice: number | null;
  /** 매도 체결 실현 손익(수수료 반영) */
  realizedPnl: number | null;
  /** 매입 원가 대비 실현 손익률(%) */
  realizedPnlPct: number | null;
};

/** @deprecated TradeFillDisplay 사용 */
export type TradeBuySellPrices = TradeFillDisplay;

function positionKey(t: Pick<LiveTradeRecord, "programId" | "market" | "symbol">) {
  return `${t.programId}:${t.market}:${t.symbol}`;
}

/** 체결 목록(시간순 무관) → 거래 id별 구매·판매·실현 손익 */
export function tradeFillDisplayByTradeId(
  trades: LiveTradeRecord[],
): Map<string, TradeFillDisplay> {
  const sorted = [...trades].sort((a, b) => a.atMs - b.atMs);
  const out = new Map<string, TradeFillDisplay>();
  const positions = new Map<string, { qty: number; cost: number }>();

  for (const t of sorted) {
    const key = positionKey(t);
    if (t.side === "buy") {
      out.set(t.id, {
        buyPrice: t.price,
        sellPrice: null,
        realizedPnl: null,
        realizedPnlPct: null,
      });
      const pos = positions.get(key) ?? { qty: 0, cost: 0 };
      pos.qty += t.quantity;
      pos.cost += t.amount + (t.feeAmount ?? 0);
      positions.set(key, pos);
      continue;
    }

    const pos = positions.get(key);
    const storedEntry =
      typeof t.entryPrice === "number" &&
      Number.isFinite(t.entryPrice) &&
      t.entryPrice > 0
        ? t.entryPrice
        : null;
    const buyPrice =
      storedEntry ?? (pos && pos.qty > 0 ? pos.cost / pos.qty : null);

    let realizedPnl: number | null = null;
    let realizedPnlPct: number | null = null;

    if (buyPrice != null && buyPrice > 0 && pos && pos.qty > 0) {
      const sellQty = Math.min(t.quantity, pos.qty);
      if (sellQty > 0) {
        const proceeds =
          (t.amount / t.quantity) * sellQty - (t.feeAmount ?? 0);
        const costPortion = buyPrice * sellQty;
        realizedPnl = proceeds - costPortion;
        realizedPnlPct =
          costPortion > 1e-9 ? (realizedPnl / costPortion) * 100 : null;
        const costPortionFromPos = buyPrice * sellQty;
        pos.qty -= sellQty;
        pos.cost -= costPortionFromPos;
        if (pos.qty <= 1e-9) {
          pos.qty = 0;
          pos.cost = 0;
        }
        positions.set(key, pos);
      }
    }

    out.set(t.id, {
      buyPrice,
      sellPrice: t.price,
      realizedPnl,
      realizedPnlPct,
    });
  }

  return out;
}

/** @deprecated tradeFillDisplayByTradeId */
export const buySellPricesByTradeId = tradeFillDisplayByTradeId;
