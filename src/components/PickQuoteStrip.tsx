import { memo } from "react";
import { ko } from "../i18n/ko";
import { displayStockSymbol, formatPercent, formatPrice, formatTurnover } from "../lib/format";

export interface PickQuoteStripProps {
  symbol: string;
  price?: number | null;
  currency?: string | null;
  changePercent?: number | null;
  turnover?: number | null;
  size?: "sm" | "md";
  className?: string;
}

function PickQuoteStripInner({
  symbol,
  price,
  currency,
  changePercent,
  turnover,
  size = "sm",
  className = "",
}: PickQuoteStripProps) {
  const up = (changePercent ?? 0) >= 0;
  const hasChg = changePercent != null;
  const hasPrice = price != null;
  const hasTurnover = turnover != null && Number.isFinite(turnover) && turnover > 0;

  const sym = displayStockSymbol(symbol);
  const cur = currency ?? undefined;

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
          {formatPrice(price, cur)}
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
      {hasTurnover && (
        <span
          className="pick-quote__turnover"
          title={ko.app.pickTurnoverTitle}
        >
          {ko.app.pickTurnoverShort} {formatTurnover(turnover, cur)}
        </span>
      )}
    </div>
  );
}

export default memo(PickQuoteStripInner);
