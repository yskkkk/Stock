import { memo } from "react";
import { ko } from "../i18n/ko";

export interface QuoteCurrencyToggleProps {
  inKrw: boolean;
  onToggle: () => void;
  fxValuationDate?: string | null;
  className?: string;
  /** ₩/$ 만 표시 — 거래대금 상위 제목 옆 */
  iconOnly?: boolean;
}

function QuoteCurrencyToggleInner({
  inKrw,
  onToggle,
  fxValuationDate,
  className = "",
  iconOnly = false,
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
        "btn btn--secondary quote-currency-toggle",
        iconOnly ? "quote-currency-toggle--icon-only" : "",
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
        {inKrw ? "$" : "₩"}
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
