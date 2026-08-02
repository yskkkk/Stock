import { useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import {
  computeExpectedReturnCalc,
  type ExpectedReturnCalcInput,
} from "../lib/expectedReturnCalc";
import "./expected-return-calc-tab.css";

type FieldKey = keyof ExpectedReturnCalcInput;

const DEFAULTS: Record<FieldKey, string> = {
  currentPrice: "120",
  currentEps: "3.33",
  earningsGrowthPct: "15.2",
  avgPer: "17.7",
  dividendPayoutPct: "25",
  years: "10",
  targetReturnPct: "15",
};

function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPrice(n);
}

function fmtPctFromRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatPercent(n * 100);
}

export default function ExpectedReturnCalcTab() {
  const [fields, setFields] = useState(DEFAULTS);

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

  const yearsLabel = Number.isFinite(input.years)
    ? String(Math.floor(input.years))
    : "—";

  return (
    <section
      className="expected-return-calc card"
      aria-label={ko.app.expectedReturnCalcAria}
    >
      <header className="expected-return-calc__head">
        <h2 className="expected-return-calc__title">
          {ko.app.expectedReturnCalcTitle}
        </h2>
        <p className="expected-return-calc__sub">{ko.app.expectedReturnCalcSubtitle}</p>
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
          ).map(([key, label]) => (
            <label key={key} className="expected-return-calc__field">
              <span className="expected-return-calc__label">{label}</span>
              <input
                type="text"
                inputMode="decimal"
                className="expected-return-calc__input"
                value={fields[key]}
                onChange={(e) => onChange(key, e.target.value)}
                autoComplete="off"
              />
            </label>
          ))}
          <button
            type="button"
            className="expected-return-calc__reset"
            onClick={() => setFields(DEFAULTS)}
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
                  <dd>{fmtMoney(result.futurePrice)}</dd>
                </div>
                <div>
                  <dt>{ko.app.expectedReturnCalcTotalDiv}</dt>
                  <dd>{fmtMoney(result.totalDividends)}</dd>
                </div>
                <div>
                  <dt>{ko.app.expectedReturnCalcTotalProceeds}</dt>
                  <dd>{fmtMoney(result.totalProceeds)}</dd>
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
                    {fmtMoney(result.maxBuyPrice)}
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
                        <td>{fmtMoney(row.eps)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">{ko.app.expectedReturnCalcTotalEps}</th>
                      <td>{fmtMoney(result.totalEps)}</td>
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
