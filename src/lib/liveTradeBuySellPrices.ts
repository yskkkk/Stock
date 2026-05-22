import type { LiveTradeRecord } from "../api";

export type TradeBuySellPrices = {
  buyPrice: number | null;
  sellPrice: number | null;
};

function positionKey(t: Pick<LiveTradeRecord, "programId" | "market" | "symbol">) {
  return `${t.programId}:${t.market}:${t.symbol}`;
}

/** 체결 목록(시간순 무관) → 거래 id별 구매·판매 단가 */
export function buySellPricesByTradeId(
  trades: LiveTradeRecord[],
): Map<string, TradeBuySellPrices> {
  const sorted = [...trades].sort((a, b) => a.atMs - b.atMs);
  const out = new Map<string, TradeBuySellPrices>();
  const positions = new Map<string, { qty: number; cost: number }>();

  for (const t of sorted) {
    const key = positionKey(t);
    if (t.side === "buy") {
      out.set(t.id, { buyPrice: t.price, sellPrice: null });
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
    out.set(t.id, { buyPrice, sellPrice: t.price });

    if (pos && buyPrice != null && buyPrice > 0) {
      const sellQty = Math.min(t.quantity, pos.qty);
      const costPortion = buyPrice * sellQty;
      pos.qty -= sellQty;
      pos.cost -= costPortion;
      if (pos.qty <= 1e-9) {
        pos.qty = 0;
        pos.cost = 0;
      }
      positions.set(key, pos);
    }
  }

  return out;
}
