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

const QTY_EPS = 1e-12;

/**
 * 체결 목록(시간순 무관) → 거래 id별 구매·판매·실현 손익
 * — 매도 행의 entryPrice(박스 mid 등)는 표시·손익에 쓰지 않고, 선행 매수의 가중 평균 원가만 사용
 */
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
    const avgCost =
      pos && pos.qty > QTY_EPS ? pos.cost / pos.qty : null;
    const buyPrice = avgCost;

    let realizedPnl: number | null = null;
    let realizedPnlPct: number | null = null;

    if (buyPrice != null && buyPrice > 0 && pos && pos.qty > QTY_EPS) {
      const sellQty = Math.min(t.quantity, pos.qty);
      if (sellQty > QTY_EPS) {
        const sellFee =
          t.quantity > QTY_EPS
            ? ((t.feeAmount ?? 0) / t.quantity) * sellQty
            : 0;
        const proceeds = sellQty * t.price - sellFee;
        const costPortion = buyPrice * sellQty;
        realizedPnl = proceeds - costPortion;
        realizedPnlPct =
          costPortion > 1e-9 ? (realizedPnl / costPortion) * 100 : null;
        pos.qty -= sellQty;
        pos.cost -= costPortion;
        if (pos.qty <= QTY_EPS) {
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
