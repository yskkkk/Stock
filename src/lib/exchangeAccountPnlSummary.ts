import type { LiveTradeHolding, LiveTradeRecord } from "../api";
import { formatSignedMoney } from "./format";

export function exchangeSymbolKey(
  item: Pick<LiveTradeRecord | LiveTradeHolding, "market" | "symbol">,
): string {
  return `${item.market}:${String(item.symbol).trim().toUpperCase()}`;
}

export type ExchangeSymbolPnl = {
  key: string;
  symbol: string;
  market: LiveTradeRecord["market"];
  name: string;
  currency: string;
  totalBuyCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number | null;
};

export type ExchangeAccountPnlSummary = {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPct: number | null;
  realizedLabel: string;
  unrealizedLabel: string;
  totalPnlLabel: string;
  bySymbol: Map<string, ExchangeSymbolPnl>;
};

type SymAcc = {
  symbol: string;
  market: LiveTradeRecord["market"];
  name: string;
  currency: string;
  totalBuyCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
};

function toKrw(amount: number, currency: string, usdKrwRate: number | null): number | null {
  if (currency === "USD") {
    if (usdKrwRate == null || usdKrwRate <= 0) return null;
    return amount * usdKrwRate;
  }
  return amount;
}

/** 거래소 계좌(토스·빗썸) — 종목별·전체 누적 수익률 */
export function exchangeAccountPnlSummary(
  trades: LiveTradeRecord[],
  holdings: LiveTradeHolding[] = [],
  opts?: { usdKrwRate?: number | null },
): ExchangeAccountPnlSummary {
  const usdKrwRate = opts?.usdKrwRate ?? null;
  const sorted = [...trades].sort((a, b) => a.atMs - b.atMs);
  const positions = new Map<string, { qty: number; cost: number }>();
  const bySymbol = new Map<string, SymAcc>();

  const ensureSym = (
    key: string,
    seed: Pick<SymAcc, "symbol" | "market" | "name" | "currency">,
  ): SymAcc => {
    let sym = bySymbol.get(key);
    if (!sym) {
      sym = {
        ...seed,
        totalBuyCost: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
      };
      bySymbol.set(key, sym);
    }
    return sym;
  };

  let accountRealizedKrw = 0;
  let accountBuyCostKrw = 0;
  let hasUsd = false;
  let hasKrw = false;

  for (const t of sorted) {
    const key = exchangeSymbolKey(t);
    const sym = ensureSym(key, {
      symbol: t.symbol,
      market: t.market,
      name: t.name,
      currency: t.currency,
    });
    if (t.currency === "USD") hasUsd = true;
    else hasKrw = true;

    if (t.side === "buy") {
      const buyCost = t.amount + (t.feeAmount ?? 0);
      sym.totalBuyCost += buyCost;
      const krw = toKrw(buyCost, t.currency, usdKrwRate);
      if (krw != null) accountBuyCostKrw += krw;
    }

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
    const realized = proceeds - costPortion;
    sym.realizedPnl += realized;
    const rKrw = toKrw(realized, t.currency, usdKrwRate);
    if (rKrw != null) accountRealizedKrw += rKrw;

    pos.qty -= sellQty;
    pos.cost -= costPortion;
    if (pos.qty <= 1e-9) {
      pos.qty = 0;
      pos.cost = 0;
    }
  }

  let accountUnrealizedKrw = 0;
  for (const h of holdings) {
    const key = exchangeSymbolKey(h);
    const sym = ensureSym(key, {
      symbol: h.symbol,
      market: h.market,
      name: h.name,
      currency: h.currency,
    });
    if (h.currency === "USD") hasUsd = true;
    else hasKrw = true;

    let unreal = 0;
    if (h.unrealizedPnl != null && Number.isFinite(h.unrealizedPnl)) {
      unreal = h.unrealizedPnl;
    } else if (h.marketValue != null && Number.isFinite(h.marketValue)) {
      unreal = h.marketValue - h.costBasis;
    }
    sym.unrealizedPnl = unreal;

    if (sym.totalBuyCost <= 0 && h.costBasis > 0) {
      sym.totalBuyCost = h.costBasis;
      const krw = toKrw(h.costBasis, h.currency, usdKrwRate);
      if (krw != null) accountBuyCostKrw += krw;
    }

    const uKrw = toKrw(unreal, h.currency, usdKrwRate);
    if (uKrw != null) accountUnrealizedKrw += uKrw;
  }

  const resultBySymbol = new Map<string, ExchangeSymbolPnl>();
  for (const [key, sym] of bySymbol) {
    const totalPnl = sym.realizedPnl + sym.unrealizedPnl;
    const totalReturnPct =
      sym.totalBuyCost > 1e-9 ? (totalPnl / sym.totalBuyCost) * 100 : null;
    resultBySymbol.set(key, {
      key,
      symbol: sym.symbol,
      market: sym.market,
      name: sym.name,
      currency: sym.currency,
      totalBuyCost: sym.totalBuyCost,
      realizedPnl: sym.realizedPnl,
      unrealizedPnl: sym.unrealizedPnl,
      totalPnl,
      totalReturnPct:
        totalReturnPct != null && Number.isFinite(totalReturnPct) ? totalReturnPct : null,
    });
  }

  const totalPnl = accountRealizedKrw + accountUnrealizedKrw;
  const totalReturnPct =
    accountBuyCostKrw > 1e-9 ? (totalPnl / accountBuyCostKrw) * 100 : null;
  const labelCcy = hasUsd && !hasKrw ? "USD" : "KRW";

  return {
    realizedPnl: accountRealizedKrw,
    unrealizedPnl: accountUnrealizedKrw,
    totalPnl,
    totalReturnPct:
      totalReturnPct != null && Number.isFinite(totalReturnPct) ? totalReturnPct : null,
    realizedLabel: formatSignedMoney(accountRealizedKrw, labelCcy),
    unrealizedLabel: formatSignedMoney(accountUnrealizedKrw, labelCcy),
    totalPnlLabel: formatSignedMoney(totalPnl, labelCcy),
    bySymbol: resultBySymbol,
  };
}
