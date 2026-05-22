import type { LiveTradeHolding } from "../api";
import { formatPrice, formatSignedMoney } from "./format";

export type CurrencyTotals = Partial<Record<"KRW" | "USD", number>>;

export type HoldingsPnlAggregate = {
  pnlByCurrency: CurrencyTotals;
  investedByCurrency: CurrencyTotals;
  marketByCurrency: CurrencyTotals;
};

function holdingCurrency(h: LiveTradeHolding): "KRW" | "USD" {
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
