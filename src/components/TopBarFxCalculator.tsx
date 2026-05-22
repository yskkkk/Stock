import { memo, useId, useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import { formatPrice } from "../lib/format";

export interface TopBarFxCalculatorProps {
  rate: number | null;
  valuationDate?: string | null;
}

type FxDir = "usdToKrw" | "krwToUsd";

function parseAmountInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function TopBarFxCalculatorInner({ rate, valuationDate }: TopBarFxCalculatorProps) {
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

  return (
    <div
      className="top-bar__fx-calc"
      role="group"
      aria-labelledby={`${amountId}-title`}
      title={basisTitle}
    >
      <div className="top-bar__fx-calc-head">
        <span id={`${amountId}-title`} className="top-bar__fx-calc-title">
          {ko.app.topBarFxCalcTitle}
        </span>
        <span className="top-bar__fx-calc-rate" aria-live="polite">
          {rateLine}
        </span>
      </div>
      <div className="top-bar__fx-calc-body">
        <div className="top-bar__fx-calc-mode" role="group" aria-label={ko.app.topBarFxCalcModeAria}>
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
        <label className="top-bar__fx-calc-field">
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            className="input top-bar__fx-calc-input"
            placeholder={dir === "usdToKrw" ? "USD" : "KRW"}
            aria-label={ko.app.topBarFxCalcAmountAria}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <span className="top-bar__fx-calc-eq" aria-hidden>
          =
        </span>
        <output className="top-bar__fx-calc-result" htmlFor={amountId} aria-live="polite">
          {resultText}
        </output>
      </div>
    </div>
  );
}

export default memo(TopBarFxCalculatorInner);
