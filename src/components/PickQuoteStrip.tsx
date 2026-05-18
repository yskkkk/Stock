import { displayStockSymbol, formatPercent, formatPrice } from "../lib/format";

export interface PickQuoteStripProps {
  symbol: string;
  price?: number | null;
  currency?: string | null;
  changePercent?: number | null;
  size?: "sm" | "md";
  className?: string;
}

export default function PickQuoteStrip({
  symbol,
  price,
  currency,
  changePercent,
  size = "sm",
  className = "",
}: PickQuoteStripProps) {
  const up = (changePercent ?? 0) >= 0;
  const hasChg = changePercent != null;
  const hasPrice = price != null;

  const sym = displayStockSymbol(symbol);

  return (
    <div
      className={["pick-quote", `pick-quote--${size}`, className]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={`${sym} 시세`}
    >
      {sym ? <span className="pick-quote__symbol">{sym}</span> : null}
      {hasPrice && (
        <span className="pick-quote__price">
          {formatPrice(price, currency ?? undefined)}
        </span>
      )}
      {hasChg && (
        <span
          className={
            up ? "pick-quote__chg pick-quote__chg--up" : "pick-quote__chg pick-quote__chg--down"
          }
        >
          <span className="pick-quote__chg-arrow" aria-hidden>
            {up ? "▲" : "▼"}
          </span>
          {formatPercent(changePercent)}
        </span>
      )}
    </div>
  );
}
