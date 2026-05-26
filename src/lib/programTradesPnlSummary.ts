import type { LiveTradeHolding, LiveTradeRecord } from "../api";
import { formatSignedMoney } from "./format";

function positionKey(t: Pick<LiveTradeRecord, "programId" | "market" | "symbol">) {
  return `${t.programId}:${t.market}:${t.symbol}`;
}

/** 체결·보유 → 실현손익·총 수익률(전체 매수 원가 대비, 포트폴리오 스냅샷과 동일) */
export function programTradesPnlSummary(
  trades: LiveTradeRecord[],
  holdings: LiveTradeHolding[] = [],
): {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number | null;
  realizedLabel: string;
} {
  const sorted = [...trades].sort((a, b) => a.atMs - b.atMs);
  const positions = new Map<string, { qty: number; cost: number }>();
  let realizedPnl = 0;
  let totalBuyCost = 0;

  for (const t of sorted) {
    if (t.side === "buy") {
      totalBuyCost += t.amount + (t.feeAmount ?? 0);
    }
    const key = positionKey(t);
    let pos = positions.get(key);
    if (!pos) {
      pos = { qty: 0, cost: 0 };
      positions.set(key, pos);
    }
    if (t.side === "buy") {
      pos.qty += t.quantity;
      pos.cost += t.amount + (t.feeAmount ?? 0);
      continue;
    }
    const sellQty = Math.min(t.quantity, pos.qty);
    if (sellQty <= 0) continue;
    const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0;
    const proportionalFee =
      t.quantity > 0 ? ((t.feeAmount ?? 0) / t.quantity) * sellQty : 0;
    const proceeds = (t.amount / t.quantity) * sellQty - proportionalFee;
    const costPortion = avgCost * sellQty;
    realizedPnl += proceeds - costPortion;
    pos.qty -= sellQty;
    pos.cost -= costPortion;
    if (pos.qty <= 1e-9) {
      pos.qty = 0;
      pos.cost = 0;
    }
  }

  let unrealizedPnl = 0;
  for (const h of holdings) {
    if (h.unrealizedPnl != null && Number.isFinite(h.unrealizedPnl)) {
      unrealizedPnl += h.unrealizedPnl;
    } else if (h.marketValue != null && Number.isFinite(h.marketValue)) {
      unrealizedPnl += h.marketValue - h.costBasis;
    }
  }

  const totalPnl = realizedPnl + unrealizedPnl;
  const totalReturnPct =
    totalBuyCost > 1e-9 ? (totalPnl / totalBuyCost) * 100 : null;

  const hasUsd =
    trades.some((t) => t.currency === "USD") ||
    holdings.some((h) => h.currency === "USD" || h.market === "us");
  const realizedLabel = formatSignedMoney(
    realizedPnl,
    hasUsd ? "USD" : "KRW",
  );

  return {
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalReturnPct:
      totalReturnPct != null && Number.isFinite(totalReturnPct)
        ? totalReturnPct
        : null,
    realizedLabel,
  };
}
