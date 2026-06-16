import { useEffect, useMemo, useState } from "react";
import { ko } from "../i18n/ko";
import {
  formatEarningsBubbleFinancialLines,
  loadEarningsBubbleFinancials,
  type EarningsBubbleFinancialSummary,
} from "../lib/earningsBubbleFinancials";
import { peerPerVerdictClassName } from "../lib/peerPerComparison";
import StockHoverBubbleActions from "./StockHoverBubbleActions";

export default function StockEarningsHoverBubbleBody({
  symbol,
  name,
  market,
  sectorLabel,
  earningsWhen,
  earningsCountdown,
  tvChartUrl,
  price,
  currency,
  variant = "earnings",
  onAfterAction,
}: {
  symbol: string;
  name: string;
  market: "kr" | "us";
  sectorLabel?: string | null;
  earningsWhen?: string | null;
  earningsCountdown?: string | null;
  tvChartUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  variant?: "vault" | "earnings";
  onAfterAction?: (action: "chart" | "financials") => void;
}) {
  const [finSummary, setFinSummary] = useState<
    EarningsBubbleFinancialSummary | null | "loading"
  >("loading");

  useEffect(() => {
    const sym = symbol.trim();
    if (!sym) {
      setFinSummary(null);
      return;
    }
    const ac = new AbortController();
    setFinSummary("loading");
    void loadEarningsBubbleFinancials(sym, ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) setFinSummary(data);
      })
      .catch(() => {
        if (!ac.signal.aborted) setFinSummary(null);
      });
    return () => ac.abort();
  }, [symbol]);

  const finLabels = useMemo(
    () => ({
      per: ko.financials.per.replace(/\s*\(.+\)\s*$/, ""),
      eps: ko.financials.eps.replace(/\s*\(.+\)\s*$/, ""),
      pbr: ko.financials.pbr.replace(/\s*\(.+\)\s*$/, ""),
      profitMargin: ko.financials.profitMargin,
      roe: ko.financials.roe,
      yoyRevenue: ko.macro.earningsBubbleYoyRevenue,
      yoyNetIncome: ko.macro.earningsBubbleYoyNetIncome,
      peerMedianPer: ko.financials.peerMedianPer,
      vsPeerHigh: ko.financials.perVsPeerHigh,
      vsPeerLow: ko.financials.perVsPeerLow,
      vsPeerSimilar: ko.financials.perVsPeerSimilar,
    }),
    [],
  );

  const activeFin =
    finSummary !== "loading" && finSummary != null ? finSummary : null;
  const finLines = activeFin
    ? formatEarningsBubbleFinancialLines(activeFin, finLabels)
    : null;
  const code = symbol.replace(/^KR_/i, "");

  return (
    <>
      <p className="earnings-icon-rail__bubble-name">{name}</p>
      <p className="earnings-icon-rail__bubble-code">
        {code}
        {sectorLabel ? ` · ${sectorLabel}` : ""}
      </p>
      {earningsWhen ? (
        <p className="earnings-icon-rail__bubble-when">{earningsWhen}</p>
      ) : null}
      {earningsCountdown ? (
        <p className="earnings-icon-rail__bubble-countdown" aria-live="polite">
          {earningsCountdown}
        </p>
      ) : null}
      {finSummary === "loading" ? (
        <p className="earnings-icon-rail__bubble-fin earnings-icon-rail__bubble-fin--muted">
          {ko.macro.earningsBubbleFinancialsLoading}
        </p>
      ) : activeFin && finLines ? (
        <div className="earnings-icon-rail__bubble-fin">
          <p className="earnings-icon-rail__bubble-fin-title">
            {ko.macro.earningsBubbleFinancials} · {activeFin.periodLabel}
          </p>
          <p className="earnings-icon-rail__bubble-fin-line">{finLines.line1}</p>
          {finLines.peerLine ? (
            <div className="earnings-icon-rail__bubble-peer">
              <span
                className={`earnings-icon-rail__bubble-peer-badge ${peerPerVerdictClassName(finLines.peerLine.verdict)}`}
              >
                {finLines.peerLine.verdictLabel}
              </span>
              <p className="earnings-icon-rail__bubble-fin-line earnings-icon-rail__bubble-fin-peer-detail">
                {finLines.peerLine.detailText}
              </p>
            </div>
          ) : null}
          <p className="earnings-icon-rail__bubble-fin-line">{finLines.line2}</p>
          {finLines.yoyLines.map((line) => (
            <p
              key={line.text}
              className={
                line.yoyPct != null && line.yoyPct >= 0
                  ? "earnings-icon-rail__bubble-fin-line earnings-icon-rail__bubble-fin-yoy earnings-icon-rail__bubble-fin-yoy--up"
                  : line.yoyPct != null && line.yoyPct < 0
                    ? "earnings-icon-rail__bubble-fin-line earnings-icon-rail__bubble-fin-yoy earnings-icon-rail__bubble-fin-yoy--down"
                    : "earnings-icon-rail__bubble-fin-line earnings-icon-rail__bubble-fin-yoy"
              }
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : null}
      <StockHoverBubbleActions
        variant={variant}
        symbol={symbol}
        name={name}
        market={market}
        price={price}
        currency={currency}
        tvChartUrl={tvChartUrl}
        onAfterAction={onAfterAction}
      />
    </>
  );
}
