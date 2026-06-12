import { useEffect, useRef, useState } from "react";
import { fetchBuffettIntrinsicValue } from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import type { BuffettIntrinsicValueResponse, BuffettIntrinsicVerdict } from "../types";

function fmtMoney(value: number | null | undefined, currency?: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (currency === "KRW") {
    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }
  return formatPrice(value, currency);
}

function fmtRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value * 100);
}

function verdictLabel(verdict: BuffettIntrinsicVerdict | null): string {
  if (!verdict) return "—";
  const map = ko.financials.buffettVerdict;
  return map[verdict] ?? verdict;
}

function verdictClass(verdict: BuffettIntrinsicVerdict | null): string {
  if (!verdict) return "financials-tab__buffett-verdict";
  return `financials-tab__buffett-verdict financials-tab__buffett-verdict--${verdict}`;
}

type InputRow = { key: string; label: string; value: string; source?: string | null };

function buildInputRows(data: BuffettIntrinsicValueResponse): InputRow[] {
  const { inputs: i } = data;
  return [
    {
      key: "eps",
      label: ko.financials.buffettEps0,
      value: fmtMoney(i.eps0, data.currency),
      source: i.epsSource,
    },
    {
      key: "discount",
      label: ko.financials.buffettDiscount,
      value: i.discountRatePct != null ? `${i.discountRatePct.toFixed(2)}%` : "—",
      source: i.discountRateSource,
    },
    {
      key: "growth10y",
      label: ko.financials.buffettGrowth10y,
      value: fmtRate(i.growth10y),
      source: i.growth10ySource,
    },
    {
      key: "growthTerminal",
      label: ko.financials.buffettGrowthTerminal,
      value: fmtRate(i.growthTerminal),
      source: i.growthTerminalSource,
    },
    {
      key: "debt",
      label: ko.financials.buffettDebt,
      value: fmtMoney(i.debtPerShare, data.currency),
      source: i.debtPerShareSource,
    },
    {
      key: "price",
      label: ko.financials.price,
      value: fmtMoney(i.price, data.currency),
    },
  ];
}

export default function BuffettIntrinsicPanel({ symbol }: { symbol: string | null }) {
  const [data, setData] = useState<BuffettIntrinsicValueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!symbol?.trim()) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetchBuffettIntrinsicValue(symbol, ac.signal);
        if (seq !== seqRef.current || ac.signal.aborted) return;
        setData(res);
      } catch (err: unknown) {
        if (seq !== seqRef.current || ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === seqRef.current && !ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [symbol]);

  if (!symbol) return null;

  const currency = data?.currency;

  return (
    <section
      className="financials-tab__buffett"
      aria-label={ko.financials.buffettTitle}
      aria-busy={loading}
    >
      <header className="financials-tab__buffett-head">
        <h4 className="financials-tab__buffett-title">{ko.financials.buffettTitle}</h4>
        <p className="financials-tab__buffett-hint">{ko.financials.buffettHint}</p>
      </header>

      {loading && !data ? (
        <p className="financials-tab__muted">{ko.financials.buffettLoading}</p>
      ) : null}

      {error ? (
        <p className="financials-tab__error" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          {!data.quality.computable ? (
            <p className="financials-tab__buffett-unavailable" role="status">
              {ko.financials.buffettUnavailable}
            </p>
          ) : null}

          {data.quality.missing.length > 0 ? (
            <ul className="financials-tab__buffett-missing">
              {data.quality.missing.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          <div className="financials-tab__buffett-results">
            <div className="financials-tab__buffett-card">
              <span className="financials-tab__buffett-card-label">
                {ko.financials.buffettSimpleFair}
              </span>
              <strong className="financials-tab__buffett-card-value">
                {fmtMoney(data.outputs.simpleFairPrice, currency)}
              </strong>
              <span className="financials-tab__buffett-card-note">
                {ko.financials.buffettSimpleFormula}
              </span>
            </div>
            <div className="financials-tab__buffett-card financials-tab__buffett-card--primary">
              <span className="financials-tab__buffett-card-label">
                {ko.financials.buffettIntrinsic}
              </span>
              <strong className="financials-tab__buffett-card-value">
                {fmtMoney(data.outputs.intrinsicPerShare, currency)}
              </strong>
              {data.outputs.explicitPv != null ? (
                <span className="financials-tab__buffett-card-note">
                  {ko.financials.buffettExplicitPv}:{" "}
                  {fmtMoney(data.outputs.explicitPv, currency)}
                  {data.outputs.terminalPv != null
                    ? ` · ${ko.financials.buffettTerminalPv}: ${fmtMoney(data.outputs.terminalPv, currency)}`
                    : ` · ${ko.financials.buffettTerminalSkipped}`}
                </span>
              ) : null}
            </div>
            <div className="financials-tab__buffett-card">
              <span className="financials-tab__buffett-card-label">
                {ko.financials.buffettMos} ({formatPercent(data.inputs.marginOfSafety * 100)})
              </span>
              <strong className="financials-tab__buffett-card-value">
                {fmtMoney(data.outputs.marginOfSafetyPrice, currency)}
              </strong>
              <span className={verdictClass(data.outputs.verdict)}>
                {verdictLabel(data.outputs.verdict)}
              </span>
            </div>
          </div>

          <table className="financials-tab__buffett-inputs">
            <tbody>
              {buildInputRows(data).map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <span className="financials-tab__buffett-input-value">{row.value}</span>
                    {row.source ? (
                      <span className="financials-tab__buffett-input-source">{row.source}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.historicalEps.length > 0 ? (
            <div className="financials-tab__buffett-eps-history">
              <h5 className="financials-tab__buffett-eps-title">
                {ko.financials.buffettEpsHistory}
              </h5>
              <div className="financials-tab__buffett-eps-chips">
                {data.historicalEps.map((row) => (
                  <span key={`${row.year}:${row.eps}`} className="financials-tab__buffett-eps-chip">
                    {row.label || row.year}: {fmtMoney(row.eps, currency)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.quality.warnings.length > 0 ? (
            <ul className="financials-tab__buffett-warnings">
              {data.quality.warnings.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}

          <p className="financials-tab__buffett-disclaimer">{data.disclaimer}</p>
        </>
      ) : null}
    </section>
  );
}
