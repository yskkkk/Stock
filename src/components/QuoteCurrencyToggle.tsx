import { memo } from "react";
import { ko } from "../i18n/ko";

export interface QuoteCurrencyToggleProps {
  inKrw: boolean;
  onToggle: () => void;
  fxValuationDate?: string | null;
  className?: string;
  /** ₩/$ 만 표시 — 거래대금 상위 제목 옆 */
  iconOnly?: boolean;
  /** true면 현재 표시 통화 아이콘(원→₩, 달러→$). 기본은 누르면 전환될 통화 */
  iconShowsActive?: boolean;
}

function QuoteCurrencyGlyph({
  symbol,
  className = "",
}: {
  symbol: "₩" | "$";
  className?: string;
}) {
  return (
    <span className={["quote-currency-toggle__glyph", className].filter(Boolean).join(" ")} aria-hidden>
      {symbol}
    </span>
  );
}

function currencyIcon(iconShowsActive: boolean, inKrw: boolean) {
  const showKrw = iconShowsActive ? inKrw : !inKrw;
  return showKrw ? (
    <QuoteCurrencyGlyph symbol="₩" />
  ) : (
    <QuoteCurrencyGlyph symbol="$" />
  );
}

function QuoteCurrencyToggleInner({
  inKrw,
  onToggle,
  fxValuationDate,
  className = "",
  iconOnly = false,
  iconShowsActive = false,
}: QuoteCurrencyToggleProps) {
  const title = inKrw
    ? fxValuationDate
      ? ko.app.quoteCurrencyFxBasis.replace("{date}", fxValuationDate)
      : ko.app.quoteCurrencyShowUsd
    : ko.app.quoteCurrencyShowKrw;

  return (
    <button
      type="button"
      className={[
        "quote-currency-toggle",
        iconOnly ? "quote-currency-toggle--icon-only" : "quote-currency-toggle--labeled",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      title={title}
      aria-label={ko.app.quoteCurrencyToggleAria}
      aria-pressed={inKrw}
    >
      <span className="quote-currency-toggle__icon" aria-hidden>
        {currencyIcon(iconShowsActive, inKrw)}
      </span>
      {iconOnly ? null : (
        <span className="quote-currency-toggle__label">
          {inKrw ? "USD" : "원화"}
        </span>
      )}
    </button>
  );
}

export default memo(QuoteCurrencyToggleInner);
