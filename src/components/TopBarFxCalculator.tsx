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

function formatAmountInput(value: string, currency: "USD" | "KRW"): string {
  const isUsd = currency === "USD";
  let s = value.replace(/,/g, "");
  if (isUsd) {
    s = s.replace(/[^\d.]/g, "");
    const dot = s.indexOf(".");
    if (dot >= 0) {
      const int = s.slice(0, dot).replace(/\D/g, "");
      const dec = s.slice(dot + 1).replace(/\D/g, "").slice(0, 2);
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      if (value.endsWith(".") && dec.length === 0) return `${grouped}.`;
      return dec.length > 0 ? `${grouped}.${dec}` : grouped;
    }
    const int = s.replace(/\D/g, "");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  const int = s.replace(/\D/g, "");
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
    if (result == null) return "";
    return dir === "usdToKrw"
      ? formatPrice(result, "KRW")
      : formatPrice(result, "USD");
  }, [dir, result]);

  const basisTitle =
    valuationDate != null && valuationDate !== ""
      ? ko.app.quoteCurrencyFxBasis.replace("{date}", valuationDate)
      : ko.app.topBarFxAria;

  const value =
    rate != null && Number.isFinite(rate) && rate > 0
      ? formatPrice(rate, "KRW")
      : "—";

  const meta =
    valuationDate != null && valuationDate !== ""
      ? ko.app.topBarFxBasis.replace("{date}", valuationDate)
      : null;

  const rootClass =
    layout === "strip"
      ? "fx-calc-rail fx-calc-rail--strip"
      : "fx-calc-rail fx-calc-rail--side";

  const inputCurrency = dir === "usdToKrw" ? "USD" : "KRW";
  const inputPrefix = dir === "usdToKrw" ? "$" : "원";

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
        <div
          className="fx-calc-rail__quote"
          role="status"
          aria-live="polite"
          aria-label={ko.app.topBarFxAria}
          title={basisTitle}
        >
          <span className="fx-calc-rail__quote-label">{ko.app.topBarFxLabel}</span>
          <span className="fx-calc-rail__quote-value">{value}</span>
          {meta ? <span className="fx-calc-rail__quote-meta">{meta}</span> : null}
        </div>
      </div>
      <div className="fx-calc-rail__body">
        <div className="fx-calc-rail__mode" role="group" aria-label={ko.app.topBarFxCalcModeAria}>
          <button
            type="button"
            className={
              dir === "usdToKrw"
                ? "fx-calc-rail__mode-btn fx-calc-rail__mode-btn--on"
                : "fx-calc-rail__mode-btn"
            }
            aria-pressed={dir === "usdToKrw"}
            onClick={() => {
              setDir("usdToKrw");
              setRaw("");
            }}
          >
            {ko.app.topBarFxCalcUsdToKrw}
          </button>
          <button
            type="button"
            className={
              dir === "krwToUsd"
                ? "fx-calc-rail__mode-btn fx-calc-rail__mode-btn--on"
                : "fx-calc-rail__mode-btn"
            }
            aria-pressed={dir === "krwToUsd"}
            onClick={() => {
              setDir("krwToUsd");
              setRaw("");
            }}
          >
            {ko.app.topBarFxCalcKrwToUsd}
          </button>
        </div>
        <label className="fx-calc-rail__field fx-calc-rail__field--amount">
          <div className="fx-calc-rail__input-wrap">
            <input
              id={amountId}
              type="text"
              inputMode={dir === "usdToKrw" ? "decimal" : "numeric"}
              className="input fx-calc-rail__input fx-calc-rail__input--suffixed"
              placeholder="0"
              aria-label={ko.app.topBarFxCalcAmountAria}
              value={raw}
              onChange={(e) => setRaw(formatAmountInput(e.target.value, inputCurrency))}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="fx-calc-rail__input-suffix" aria-hidden>
              {inputPrefix}
            </span>
          </div>
        </label>
        {resultText ? (
          <output className="fx-calc-rail__result" htmlFor={amountId} aria-live="polite">
            {resultText}
          </output>
        ) : null}
      </div>
    </aside>
  );
}

export default memo(TopBarFxCalculatorInner);
