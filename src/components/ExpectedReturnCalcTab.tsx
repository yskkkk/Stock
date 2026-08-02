import { useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  computeExpectedReturnCalc,
  type ExpectedReturnCalcInput,
} from "../lib/expectedReturnCalc";
import "./expected-return-calc-tab.css";

type FieldKey = keyof ExpectedReturnCalcInput;
type CalcCurrency = "KRW" | "USD";

const CURRENCY_LS_KEY = "ystock:expected-return-calc-currency";

/** 책 표 12-1(휴렛팩커드) 예시 — 달러 */
const DEFAULTS_USD: Record<FieldKey, string> = {
  currentPrice: "120",
  currentEps: "3.33",
  earningsGrowthPct: "15.2",
  avgPer: "17.7",
  dividendPayoutPct: "25",
  years: "10",
  targetReturnPct: "15",
};

/** 국내 주식 스케일 예시 — 원화 */
const DEFAULTS_KRW: Record<FieldKey, string> = {
  currentPrice: "50000",
  currentEps: "3500",
  earningsGrowthPct: "12",
  avgPer: "15",
  dividendPayoutPct: "20",
  years: "10",
  targetReturnPct: "15",
};

function defaultsFor(currency: CalcCurrency): Record<FieldKey, string> {
  return currency === "KRW" ? { ...DEFAULTS_KRW } : { ...DEFAULTS_USD };
}

function readStoredCurrency(): CalcCurrency {
  try {
    const v = localStorage.getItem(CURRENCY_LS_KEY);
    if (v === "KRW" || v === "USD") return v;
  } catch {
    /* ignore */
  }
  return "KRW";
}

function persistCurrency(currency: CalcCurrency): void {
  try {
    localStorage.setItem(CURRENCY_LS_KEY, currency);
  } catch {
    /* ignore */
  }
}

function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function fmtMoney(
  n: number | null | undefined,
  currency: CalcCurrency,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPrice(n, currency);
}

function fmtPctFromRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPercent(n * 100);
}

export default function ExpectedReturnCalcTab() {
  const [currency, setCurrency] = useState<CalcCurrency>(() =>
    readStoredCurrency(),
  );
  const [fields, setFields] = useState(() => defaultsFor(readStoredCurrency()));

  const input: ExpectedReturnCalcInput = useMemo(
    () => ({
      currentPrice: parseNum(fields.currentPrice),
      currentEps: parseNum(fields.currentEps),
      earningsGrowthPct: parseNum(fields.earningsGrowthPct),
      avgPer: parseNum(fields.avgPer),
      dividendPayoutPct: parseNum(fields.dividendPayoutPct),
      years: parseNum(fields.years),
      targetReturnPct: parseNum(fields.targetReturnPct),
    }),
    [fields],
  );

  const result = useMemo(() => computeExpectedReturnCalc(input), [input]);

  const onChange = (key: FieldKey, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const onCurrency = (next: CalcCurrency) => {
    if (next === currency) return;
    setCurrency(next);
    persistCurrency(next);
  };

  const yearsLabel = Number.isFinite(input.years)
    ? String(Math.floor(input.years))
    : "—";

  const moneyUnit =
    currency === "KRW"
      ? ko.app.expectedReturnCalcCurrencyKrw
      : ko.app.expectedReturnCalcCurrencyUsd;

  return (
    <section
      className="expected-return-calc card"
      aria-label={ko.app.expectedReturnCalcAria}
    >
      <header className="expected-return-calc__head">
        <div className="expected-return-calc__head-row">
          <h2 className="expected-return-calc__title">
            {ko.app.expectedReturnCalcTitle}
          </h2>
          <div
            className="expected-return-calc__currency-toggle"
            role="group"
            aria-label={ko.app.expectedReturnCalcCurrencyAria}
          >
            <button
              type="button"
              className={
                currency === "KRW"
                  ? "expected-return-calc__currency-btn is-active"
                  : "expected-return-calc__currency-btn"
              }
              aria-pressed={currency === "KRW"}
              onClick={() => onCurrency("KRW")}
            >
              {ko.app.expectedReturnCalcCurrencyKrw}
            </button>
            <button
              type="button"
              className={
                currency === "USD"
                  ? "expected-return-calc__currency-btn is-active"
                  : "expected-return-calc__currency-btn"
              }
              aria-pressed={currency === "USD"}
              onClick={() => onCurrency("USD")}
            >
              {ko.app.expectedReturnCalcCurrencyUsd}
            </button>
          </div>
        </div>
        <p className="expected-return-calc__sub">
          {ko.app.expectedReturnCalcSubtitle} ({moneyUnit})
        </p>
      </header>

      <div className="expected-return-calc__grid">
        <form
          className="expected-return-calc__form"
          onSubmit={(e) => e.preventDefault()}
        >
          {(
            [
              ["currentPrice", ko.app.expectedReturnCalcPrice],
              ["currentEps", ko.app.expectedReturnCalcEps],
              ["earningsGrowthPct", ko.app.expectedReturnCalcGrowth],
              ["avgPer", ko.app.expectedReturnCalcPer],
              ["dividendPayoutPct", ko.app.expectedReturnCalcPayout],
              ["years", ko.app.expectedReturnCalcYears],
              ["targetReturnPct", ko.app.expectedReturnCalcTarget],
            ] as const
          ).map(([key, label]) => {
            const unitHint =
              key === "currentPrice" || key === "currentEps"
                ? currency === "KRW"
                  ? "원"
                  : "$"
                : null;
            return (
              <label key={key} className="expected-return-calc__field">
                <span className="expected-return-calc__label">
                  {label}
                  {unitHint ? (
                    <span className="expected-return-calc__unit"> ({unitHint})</span>
                  ) : null}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="expected-return-calc__input"
                  value={fields[key]}
                  onChange={(e) => onChange(key, e.target.value)}
                  autoComplete="off"
                />
              </label>
            );
          })}
          <button
            type="button"
            className="expected-return-calc__reset"
            onClick={() => setFields(defaultsFor(currency))}
          >
            {ko.app.expectedReturnCalcReset}
          </button>
        </form>

        <div className="expected-return-calc__results" role="status">
          {!result ? (
            <p className="expected-return-calc__empty">
              {ko.app.expectedReturnCalcInvalid}
            </p>
          ) : (
            <>
              <dl className="expected-return-calc__stats">
                <div>
                  <dt>
                    {ko.app.expectedReturnCalcFuturePrice.replace(
                      "{n}",
                      yearsLabel,
                    )}
                  </dt>
                  <dd>{fmtMoney(result.futurePrice, currency)}</dd>
                </div>
                <div>
                  <dt>{ko.app.expectedReturnCalcTotalDiv}</dt>
                  <dd>{fmtMoney(result.totalDividends, currency)}</dd>
                </div>
                <div>
                  <dt>{ko.app.expectedReturnCalcTotalProceeds}</dt>
                  <dd>{fmtMoney(result.totalProceeds, currency)}</dd>
                </div>
                <div>
                  <dt>{ko.app.expectedReturnCalcCagr}</dt>
                  <dd className="expected-return-calc__em">
                    {fmtPctFromRatio(result.expectedCagr)}
                  </dd>
                </div>
                <div>
                  <dt>
                    {ko.app.expectedReturnCalcMaxBuy.replace(
                      "{pct}",
                      Number.isFinite(input.targetReturnPct)
                        ? String(input.targetReturnPct)
                        : "—",
                    )}
                  </dt>
                  <dd className="expected-return-calc__em">
                    {fmtMoney(result.maxBuyPrice, currency)}
                  </dd>
                </div>
              </dl>

              <div className="expected-return-calc__table-wrap">
                <table className="expected-return-calc__table">
                  <caption>{ko.app.expectedReturnCalcTableCaption}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{ko.app.expectedReturnCalcColYear}</th>
                      <th scope="col">{ko.app.expectedReturnCalcColEps}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.years.map((row) => (
                      <tr key={row.year}>
                        <td>{row.year}</td>
                        <td>{fmtMoney(row.eps, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{ko.app.expectedReturnCalcTotalEps}</th>
                      <td>{fmtMoney(result.totalEps, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
