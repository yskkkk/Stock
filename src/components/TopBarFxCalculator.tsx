import { memo, useId, useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import { formatPrice } from "../lib/format";

export interface TopBarFxCalculatorProps {
  rate: number | null;
  valuationDate?: string | null;
  layout?: "rail" | "strip";
}

type FxDir = "usdToKrw" | "krwToUsd";

function parseAmountInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function TopBarFxCalculatorInner({
  rate,
  valuationDate,
  layout = "rail",
}: TopBarFxCalculatorProps) {
  const amountId = useId();
  const [dir, setDir] = useState<FxDir>("usdToKrw");
  const [raw, setRaw] = useState("");

  const amount = useMemo(() => parseAmountInput(raw), [raw]);
  const hasRate = rate != null && Number.isFinite(rate) && rate > 0;

  const result = useMemo(() => {
    if (!hasRate || amount == null) return null;
    if (dir === "usdToKrw") return amount * rate!;
    return amount / rate!;
  }, [amount, dir, hasRate, rate]);

  const resultText = useMemo(() => {
    if (result == null) return "—";
    return dir === "usdToKrw"
      ? formatPrice(result, "KRW")
      : formatPrice(result, "USD");
  }, [dir, result]);

  const basisTitle =
    valuationDate != null && valuationDate !== ""
      ? ko.app.quoteCurrencyFxBasis.replace("{date}", valuationDate)
      : ko.app.topBarFxAria;

  const rateLine = hasRate
    ? ko.app.topBarFxCalcRateLine.replace("{rate}", formatPrice(rate!, "KRW"))
    : "—";

  const rootClass =
    layout === "strip"
      ? "fx-calc-rail fx-calc-rail--strip"
      : "fx-calc-rail fx-calc-rail--side";

  return (
    <aside
      className={rootClass}
      role="complementary"
      aria-labelledby={`${amountId}-title`}
      title={basisTitle}
    >
      <div className="fx-calc-rail__head">
        <span id={`${amountId}-title`} className="fx-calc-rail__title">
          {ko.app.topBarFxCalcTitle}
        </span>
        <span className="fx-calc-rail__rate" aria-live="polite">
          {rateLine}
        </span>
      </div>
      <div className="fx-calc-rail__body">
        <div className="fx-calc-rail__mode" role="group" aria-label={ko.app.topBarFxCalcModeAria}>
          <button
            type="button"
            className={dir === "usdToKrw" ? "seg active" : "seg"}
            aria-pressed={dir === "usdToKrw"}
            onClick={() => setDir("usdToKrw")}
          >
            {ko.app.topBarFxCalcUsdToKrw}
          </button>
          <button
            type="button"
            className={dir === "krwToUsd" ? "seg active" : "seg"}
            aria-pressed={dir === "krwToUsd"}
            onClick={() => setDir("krwToUsd")}
          >
            {ko.app.topBarFxCalcKrwToUsd}
          </button>
        </div>
        <label className="fx-calc-rail__field">
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            className="input fx-calc-rail__input"
            placeholder={dir === "usdToKrw" ? "USD" : "KRW"}
            aria-label={ko.app.topBarFxCalcAmountAria}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <output className="fx-calc-rail__result" htmlFor={amountId} aria-live="polite">
          {resultText}
        </output>
      </div>
    </aside>
  );
}

export default memo(TopBarFxCalculatorInner);
