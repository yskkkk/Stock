import { memo, useMemo } from "react";
import { ko } from "../i18n/ko";
import { formatPrice } from "../lib/format";

export interface TopBarFxStripProps {
  rate: number | null;
  valuationDate?: string | null;
}

function TopBarFxStripInner({ rate, valuationDate }: TopBarFxStripProps) {
  const basisTitle = useMemo(() => {
    if (valuationDate) {
      return ko.app.quoteCurrencyFxBasis.replace("{date}", valuationDate);
    }
    return ko.app.topBarFxAria;
  }, [valuationDate]);

  const value =
    rate != null && Number.isFinite(rate) && rate > 0
      ? formatPrice(rate, "KRW")
      : "—";

  const meta =
    valuationDate != null && valuationDate !== ""
      ? ko.app.topBarFxBasis.replace("{date}", valuationDate)
      : null;

  return (
    <div
      className="top-bar__fx"
      role="status"
      aria-live="polite"
      aria-label={ko.app.topBarFxAria}
      title={basisTitle}
    >
      <span className="top-bar__fx-label">{ko.app.topBarFxLabel}</span>
      <span className="top-bar__fx-value">{value}</span>
      {meta ? <span className="top-bar__fx-meta">{meta}</span> : null}
    </div>
  );
}

export default memo(TopBarFxStripInner);
