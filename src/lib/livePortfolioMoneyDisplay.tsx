import { formatPrice, formatSignedMoney } from "./format";

export function formatUsdPrice(value: number): string {
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

export function crossCurrencyAmount(
  amount: number,
  currency: string,
  usdKrwRate: number | null,
): string | null {
  if (usdKrwRate == null || !(usdKrwRate > 0) || !Number.isFinite(amount)) {
    return null;
  }
  if (currency === "KRW") {
    return formatUsdPrice(amount / usdKrwRate);
  }
  if (currency === "USD") {
    return formatPrice(amount * usdKrwRate, "KRW");
  }
  return null;
}

export function crossSignedCurrencyAmount(
  amount: number,
  currency: string,
  usdKrwRate: number | null,
): string | null {
  if (usdKrwRate == null || !(usdKrwRate > 0) || !Number.isFinite(amount)) {
    return null;
  }
  const sign = amount >= 0 ? "+" : "−";
  if (currency === "KRW") {
    const usd = amount / usdKrwRate;
    return `${sign}$${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(usd))}`;
  }
  if (currency === "USD") {
    const krw = amount * usdKrwRate;
    return `${sign}${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 0,
    }).format(Math.abs(krw))}원`;
  }
  return null;
}

export function LivePortfolioMoney({
  amount,
  currency,
  usdKrwRate,
  align = "end",
  compact = false,
}: {
  amount: number | null | undefined;
  currency: string;
  usdKrwRate: number | null;
  align?: "start" | "end";
  /** 테이블: 원화만·한 줄 */
  compact?: boolean;
}) {
  if (amount == null || !Number.isFinite(amount)) {
    return <span className="live-portfolio__money-dash">—</span>;
  }
  const sub =
    compact || currency === "KRW"
      ? null
      : crossCurrencyAmount(amount, currency, usdKrwRate);
  return (
    <span
      className={
        compact
          ? `live-portfolio__money live-portfolio__money--compact live-portfolio__money--${align}`
          : `live-portfolio__money live-portfolio__money--${align}`
      }
    >
      <span className="live-portfolio__money-primary">
        {formatPrice(amount, currency)}
      </span>
      {sub ? <span className="live-portfolio__money-sub">{sub}</span> : null}
    </span>
  );
}

export function LivePortfolioSignedMoney({
  amount,
  currency,
  usdKrwRate,
  align = "end",
  compact = false,
}: {
  amount: number;
  currency: string;
  usdKrwRate: number | null;
  align?: "start" | "end";
  compact?: boolean;
}) {
  const sub =
    compact || currency === "KRW"
      ? null
      : crossSignedCurrencyAmount(amount, currency, usdKrwRate);
  return (
    <span
      className={
        compact
          ? `live-portfolio__money live-portfolio__money--compact live-portfolio__money--${align}`
          : `live-portfolio__money live-portfolio__money--${align}`
      }
    >
      <span className="live-portfolio__money-primary">
        {formatSignedMoney(amount, currency)}
      </span>
      {sub ? (
        <span className="live-portfolio__money-sub">{sub}</span>
      ) : null}
    </span>
  );
}
