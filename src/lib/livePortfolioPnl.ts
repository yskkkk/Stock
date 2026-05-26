import type { LiveTradeHolding, LiveTradeProgram, LiveTradeRecord } from "../api";
import type { LiveTradeMarket } from "../types";
import { formatPrice, formatSignedMoney } from "./format";
import { normalizeRoundTripFeeRate } from "./netReturn";

export type CurrencyTotals = Partial<Record<"KRW" | "USD", number>>;

export type HoldingsPnlAggregate = {
  pnlByCurrency: CurrencyTotals;
  investedByCurrency: CurrencyTotals;
  marketByCurrency: CurrencyTotals;
};

function holdingCurrency(h: LiveTradeHolding): "KRW" | "USD" {
  // 코인은 빗썸 KRW 시세 기준 — 과거 데이터에 currency="USD"로 잘못 저장된 경우 포함
  if (h.market === "crypto") return "KRW";
  return h.currency === "USD" || h.market === "us" ? "USD" : "KRW";
}

export function summarizeHoldingsPnl(
  holdings: LiveTradeHolding[],
): HoldingsPnlAggregate {
  const pnlByCurrency: CurrencyTotals = {};
  const investedByCurrency: CurrencyTotals = {};
  const marketByCurrency: CurrencyTotals = {};

  for (const h of holdings) {
    const cur = holdingCurrency(h);
    investedByCurrency[cur] = (investedByCurrency[cur] ?? 0) + h.costBasis;
    if (h.marketValue != null) {
      marketByCurrency[cur] = (marketByCurrency[cur] ?? 0) + h.marketValue;
    }
    if (h.unrealizedPnl != null) {
      pnlByCurrency[cur] = (pnlByCurrency[cur] ?? 0) + h.unrealizedPnl;
    }
  }

  return { pnlByCurrency, investedByCurrency, marketByCurrency };
}

/** 현재가×수량 평가액에서 매도 수수료(왕복의 절반)를 뺀 순평가액 */
export function holdingNetMarketValue(
  h: LiveTradeHolding,
  roundTripFeeRate: number,
): number | null {
  const mv = h.marketValue;
  if (mv == null || !Number.isFinite(mv) || mv <= 0) return null;
  const askFee = normalizeRoundTripFeeRate(roundTripFeeRate) / 2;
  return Math.round(mv * (1 - askFee));
}

/** 시뮬·체결 원장 — 프로그램 예산에서 매수·매도 반영한 원화 현금 */
export function programCashKrwBalance(
  program: Pick<LiveTradeProgram, "id" | "orderAmountKrw" | "status">,
  trades: LiveTradeRecord[],
): number | null {
  const budget = program.orderAmountKrw;
  if (budget == null || !Number.isFinite(budget) || budget < 0) return null;

  const pid = program.id;
  let cash = budget;
  let hasFlow = false;

  for (const t of trades) {
    if (t.programId !== pid) continue;
    const isKrw =
      t.currency === "KRW" || t.market === "crypto" || t.market === "kr";
    if (!isKrw) continue;
    hasFlow = true;
    const fee = t.feeAmount ?? 0;
    if (t.side === "buy") cash -= t.amount + fee;
    else cash += t.amount - fee;
  }

  if (!hasFlow) {
    return program.status === "sim" ? Math.max(0, Math.round(budget)) : null;
  }
  return Math.max(0, Math.round(cash));
}

export function summarizeNetMarketByCurrency(
  holdings: LiveTradeHolding[],
  roundTripForMarket: (market: LiveTradeMarket) => number,
): CurrencyTotals {
  const marketByCurrency: CurrencyTotals = {};
  for (const h of holdings) {
    const net = holdingNetMarketValue(h, roundTripForMarket(h.market));
    if (net == null) continue;
    const cur = holdingCurrency(h);
    marketByCurrency[cur] = (marketByCurrency[cur] ?? 0) + net;
  }
  return marketByCurrency;
}

function usdToKrw(usd: number, usdKrwRate: number | null): number | null {
  if (usdKrwRate == null || !(usdKrwRate > 0) || !Number.isFinite(usd)) return null;
  return Math.round(usd * usdKrwRate);
}

/** 평가 손익 — 통화별 금액 + (가능 시) 원화 환산 */
export function formatUnrealizedPnlLabel(
  pnlByCurrency: CurrencyTotals,
  usdKrwRate: number | null,
): string {
  const usd = pnlByCurrency.USD ?? 0;
  const krw = pnlByCurrency.KRW ?? 0;
  const hasUsd = pnlByCurrency.USD != null && Math.abs(usd) > 1e-9;
  const hasKrw = pnlByCurrency.KRW != null && Math.abs(krw) > 1e-9;

  if (!hasUsd && !hasKrw) return "—";

  if (hasUsd && !hasKrw) {
    const krwEq = usdToKrw(usd, usdKrwRate);
    if (krwEq != null) {
      return `${formatSignedMoney(usd, "USD")} (${formatSignedMoney(krwEq, "KRW")})`;
    }
    return formatSignedMoney(usd, "USD");
  }

  if (hasKrw && !hasUsd) {
    return formatSignedMoney(krw, "KRW");
  }

  const usdKrwPart = usdToKrw(usd, usdKrwRate);
  if (usdKrwPart != null) {
    const totalKrw = krw + usdKrwPart;
    return `${formatSignedMoney(usd, "USD")} · ${formatSignedMoney(krw, "KRW")} (합계 ${formatSignedMoney(totalKrw, "KRW")})`;
  }
  return `${formatSignedMoney(usd, "USD")} · ${formatSignedMoney(krw, "KRW")}`;
}

export function unrealizedPnlTone(
  pnlByCurrency: CurrencyTotals,
  usdKrwRate: number | null,
): boolean | null {
  const usd = pnlByCurrency.USD ?? 0;
  const krw = pnlByCurrency.KRW ?? 0;
  const hasUsd = pnlByCurrency.USD != null;
  const hasKrw = pnlByCurrency.KRW != null;
  if (!hasUsd && !hasKrw) return null;
  const usdKrwPart = usdToKrw(usd, usdKrwRate) ?? 0;
  const total = krw + (hasUsd && usdKrwRate != null ? usdKrwPart : hasUsd ? usd : 0);
  if (hasUsd && !hasKrw && usdKrwRate == null) return usd >= 0;
  return total >= 0;
}

export function portfolioReturnPct(
  investedByCurrency: CurrencyTotals,
  marketByCurrency: CurrencyTotals,
  usdKrwRate: number | null,
): number | null {
  const currencies = new Set([
    ...Object.keys(investedByCurrency),
    ...Object.keys(marketByCurrency),
  ] as ("KRW" | "USD")[]);

  if (currencies.size === 0) return null;

  if (currencies.size === 1) {
    const cur = [...currencies][0]!;
    const inv = investedByCurrency[cur] ?? 0;
    const mkt = marketByCurrency[cur] ?? 0;
    if (!(inv > 0)) return null;
    return ((mkt - inv) / inv) * 100;
  }

  let inv = 0;
  let mkt = 0;
  for (const cur of currencies) {
    const i = investedByCurrency[cur] ?? 0;
    const m = marketByCurrency[cur] ?? 0;
    if (cur === "USD") {
      const rate = usdKrwRate;
      if (rate == null || !(rate > 0)) return null;
      inv += i * rate;
      mkt += m * rate;
    } else {
      inv += i;
      mkt += m;
    }
  }
  if (!(inv > 0)) return null;
  return ((mkt - inv) / inv) * 100;
}

/** 보유 종목만 기준 현재 수익률(평가·매입 원가) */
export function openHoldingsReturnPct(
  holdings: LiveTradeHolding[],
  usdKrwRate: number | null = null,
): number | null {
  if (holdings.length === 0) return null;
  const { investedByCurrency, marketByCurrency } =
    summarizeHoldingsPnl(holdings);
  return portfolioReturnPct(
    investedByCurrency,
    marketByCurrency,
    usdKrwRate,
  );
}

/** 매입 원가·평가금액 기준 총수익률(%) */
export function holdingGrossReturnPctFromCost(
  costBasis: number | null | undefined,
  marketValue: number | null | undefined,
): number | null {
  const cost = Number(costBasis);
  const mv = Number(marketValue);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(mv) || mv <= 0) return null;
  return ((mv - cost) / cost) * 100;
}

/** 매입 원가 대비 매도 수수료 반영 순평가 수익률(%) */
export function holdingNetReturnPctFromCost(
  costBasis: number | null | undefined,
  marketValue: number | null | undefined,
  roundTripFeeRate: number,
): number | null {
  const cost = Number(costBasis);
  const mv = Number(marketValue);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(mv) || mv <= 0) return null;
  const fee = normalizeRoundTripFeeRate(roundTripFeeRate);
  const netMv = mv * (1 - fee / 2);
  return ((netMv - cost) / cost) * 100;
}

/** 해당 종목 매수 체결 합(금액+수수료) — 동일 id 중복 제외 */
export function sumBuyCostForHolding(
  h: Pick<LiveTradeHolding, "programId" | "symbol" | "market">,
  trades: LiveTradeRecord[],
): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const t of trades) {
    if (t.programId !== h.programId || t.symbol !== h.symbol || t.market !== h.market) {
      continue;
    }
    if (t.side !== "buy") continue;
    const id = String(t.id ?? "").trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    sum += t.amount + (t.feeAmount ?? 0);
  }
  return sum;
}

/**
 * 등락률 분모(매수원금) — UI 매수총금액과 동일한 costBasis.
 * 원장이 체결 합보다 2% 이상 작을 때만 매수 체결(금액+수수료)로 보정.
 */
export function holdingPurchaseCostForReturn(
  h: LiveTradeHolding,
  trades?: LiveTradeRecord[],
): number {
  const ledger = Number(h.costBasis);
  if (!trades?.length) {
    return Number.isFinite(ledger) && ledger > 0 ? ledger : 0;
  }
  const buys = sumBuyCostForHolding(h, trades);
  if (!(Number.isFinite(ledger) && ledger > 0)) {
    return buys > 0 ? buys : 0;
  }
  if (buys > ledger * 1.05) return ledger;
  if (buys > 0 && ledger < buys * 0.98) return buys;
  return ledger;
}

/** @deprecated — holdingPurchaseCostForReturn */
export const resolvedHoldingCostBasis = holdingPurchaseCostForReturn;

/**
 * 등락률(%) = (순평가금 − 매수원금) / 매수원금 × 100
 * 순평가금 = 평가금액 × (1 − 매도 수수료/2), 매수원금 = costBasis(매수+매수수수료).
 */
export function holdingReturnPctForDisplay(
  h: LiveTradeHolding,
  roundTripForMarket: (m: LiveTradeMarket) => number,
  trades?: LiveTradeRecord[],
): number | null {
  const cost = holdingPurchaseCostForReturn(h, trades);
  const mv = Number(h.marketValue);
  if (!(cost > 0) || !Number.isFinite(mv) || mv <= 0) return null;
  return holdingNetReturnPctFromCost(
    cost,
    mv,
    roundTripForMarket(h.market),
  );
}

/** 프로그램 합계 — 종목별 매수원금·순평가 합산 후 동일 공식 */
export function programOpenReturnFromNetAndCost(
  holdings: LiveTradeHolding[],
  trades: LiveTradeRecord[],
  roundTripForMarket: (market: LiveTradeMarket) => number,
): number | null {
  let cost = 0;
  let net = 0;
  for (const h of holdings) {
    const c = holdingPurchaseCostForReturn(h, trades);
    const n = holdingNetMarketValue(h, roundTripForMarket(h.market));
    if (c > 0) cost += c;
    if (n != null && n > 0) net += n;
  }
  if (!(cost > 0) || !(net > 0)) return null;
  return ((net - cost) / cost) * 100;
}

/** 보유 종목 수익률 — 매도 수수료(왕복의 절반) 반영 순평가 기준 */
export function openHoldingsNetReturnPct(
  holdings: LiveTradeHolding[],
  roundTripForMarket: (market: LiveTradeMarket) => number,
  usdKrwRate: number | null = null,
): number | null {
  if (holdings.length === 0) return null;
  const { investedByCurrency } = summarizeHoldingsPnl(holdings);
  const netMarketByCurrency = summarizeNetMarketByCurrency(
    holdings,
    roundTripForMarket,
  );
  return portfolioReturnPct(
    investedByCurrency,
    netMarketByCurrency,
    usdKrwRate,
  );
}

export type PortfolioMetricLine = {
  id: string;
  text: string;
  /** 합계·환산 줄 */
  muted?: boolean;
  up: boolean | null;
};

function hasAmount(v: number | undefined, signed: boolean): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  return signed ? Math.abs(v) > 1e-9 : v > 0;
}

/** 타일 UI — 통화별 줄 분리(가격·손익) */
export function buildPortfolioMetricLines(
  totals: CurrencyTotals,
  usdKrwRate: number | null,
  mode: "price" | "signed",
): PortfolioMetricLine[] {
  const signed = mode === "signed";
  const fmt = signed ? formatSignedMoney : formatPrice;
  const usd = totals.USD;
  const krw = totals.KRW;
  const hasUsd = hasAmount(usd, signed);
  const hasKrw = hasAmount(krw, signed);
  const lines: PortfolioMetricLine[] = [];

  if (hasUsd) {
    lines.push({
      id: "usd",
      text: fmt(usd!, "USD"),
      up: signed ? usd! >= 0 : null,
    });
  }
  if (hasKrw) {
    lines.push({
      id: "krw",
      text: fmt(krw!, "KRW"),
      up: signed ? krw! >= 0 : null,
    });
  }
  if (hasUsd && usdKrwRate != null && usdKrwRate > 0) {
    const usdKrwPart = Math.round((usd ?? 0) * usdKrwRate);
    if (hasKrw) {
      const total = (krw ?? 0) + usdKrwPart;
      lines.push({
        id: "total",
        text: fmt(total, "KRW"),
        muted: true,
        up: signed ? total >= 0 : null,
      });
    } else {
      lines.push({
        id: "fx",
        text: fmt(usdKrwPart, "KRW"),
        muted: true,
        up: signed ? usdKrwPart >= 0 : null,
      });
    }
  }
  return lines;
}

export function formatInvestedOrMarketLabel(
  totals: CurrencyTotals,
  usdKrwRate: number | null,
): string {
  const usd = totals.USD ?? 0;
  const krw = totals.KRW ?? 0;
  const hasUsd = totals.USD != null && totals.USD > 0;
  const hasKrw = totals.KRW != null && totals.KRW > 0;
  if (!hasUsd && !hasKrw) return "—";
  if (hasUsd && !hasKrw) {
    const krwEq = usdToKrw(usd, usdKrwRate);
    if (krwEq != null) {
      return `${formatPrice(usd, "USD")} (${formatPrice(krwEq, "KRW")})`;
    }
    return formatPrice(usd, "USD");
  }
  if (hasKrw && !hasUsd) return formatPrice(krw, "KRW");
  const usdKrwPart = usdToKrw(usd, usdKrwRate);
  if (usdKrwPart != null) {
    return `${formatPrice(usd, "USD")} · ${formatPrice(krw, "KRW")} (합계 ${formatPrice(krw + usdKrwPart, "KRW")})`;
  }
  return `${formatPrice(usd, "USD")} · ${formatPrice(krw, "KRW")}`;
}
