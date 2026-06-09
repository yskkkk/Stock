import { useCallback, useEffect, useState } from "react";
import {
  executeTossHoldingPlanOrder,
  fetchTossHoldingReport,
  saveTossHoldingPlan,
  type TossHoldingReportResponse,
  type TossTestHolding,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";

function fmtRatio(v: number | null | undefined, suffix = "배"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}${suffix}`;
}

function fmtPctFrac(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatPercent(v * 100);
}

export default function TossHoldingManageModal({
  holding,
  liveOrdersEnabled,
  serverLiveOrdersEnabled,
  onClose,
  onChanged,
}: {
  holding: TossTestHolding;
  liveOrdersEnabled?: boolean;
  serverLiveOrdersEnabled?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const market = holding.market === "us" ? "us" : "kr";
  const currency = holding.currency ?? (market === "us" ? "USD" : "KRW");

  const [report, setReport] = useState<TossHoldingReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [targetBuyPrice, setTargetBuyPrice] = useState("");
  const [targetBuyAmount, setTargetBuyAmount] = useState("");
  const [targetSellPrice, setTargetSellPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [notes, setNotes] = useState("");

  const simulated = !liveOrdersEnabled || !serverLiveOrdersEnabled;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchTossHoldingReport(holding.symbol, market);
      setReport(data);
      const p = data.plan;
      setTargetBuyPrice(p?.targetBuyPrice != null ? String(p.targetBuyPrice) : "");
      setTargetBuyAmount(
        market === "us"
          ? p?.targetBuyAmountUsd != null
            ? String(p.targetBuyAmountUsd)
            : ""
          : p?.targetBuyAmountKrw != null
            ? String(p.targetBuyAmountKrw)
            : "",
      );
      setTargetSellPrice(p?.targetSellPrice != null ? String(p.targetSellPrice) : "");
      setStopLossPrice(p?.stopLossPrice != null ? String(p.stopLossPrice) : "");
      setNotes(p?.notes ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [holding.symbol, market]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePlan = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const body =
        market === "us"
          ? {
              market: "us" as const,
              targetBuyPrice: targetBuyPrice ? Number(targetBuyPrice) : null,
              targetBuyAmountUsd: targetBuyAmount ? Number(targetBuyAmount) : null,
              targetSellPrice: targetSellPrice ? Number(targetSellPrice) : null,
              stopLossPrice: stopLossPrice ? Number(stopLossPrice) : null,
              notes,
            }
          : {
              market: "kr" as const,
              targetBuyPrice: targetBuyPrice ? Number(targetBuyPrice) : null,
              targetBuyAmountKrw: targetBuyAmount ? Number(targetBuyAmount) : null,
              targetSellPrice: targetSellPrice ? Number(targetSellPrice) : null,
              stopLossPrice: stopLossPrice ? Number(stopLossPrice) : null,
              notes,
            };
      await saveTossHoldingPlan(holding.symbol, body);
      setMsg(ko.app.liveTradeTossPlanSaved);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runOrder = async (action: "buy" | "sell" | "stop") => {
    const labels = {
      buy: ko.app.liveTradeTossOrderConfirmBuy,
      sell: ko.app.liveTradeTossOrderConfirmSell,
      stop: ko.app.liveTradeTossOrderConfirmStop,
    };
    if (!window.confirm(labels[action])) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await executeTossHoldingPlanOrder(holding.symbol, {
        action,
        market,
        price:
          action === "buy"
            ? Number(targetBuyPrice)
            : action === "stop"
              ? Number(stopLossPrice)
              : Number(targetSellPrice),
        amount: action === "buy" ? Number(targetBuyAmount) : undefined,
        quantity: action !== "buy" ? holding.quantity : undefined,
      });
      setMsg(
        res.simulated
          ? ko.app.liveTradeTossOrderSimBanner
          : ko.app.liveTradeTossOrderOk,
      );
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fund = report?.fundamentals;
  const tech = report?.technical;
  const ai = report?.aiReport;
  const peer = report?.financialAnalysis?.peerComparison;
  const pm = report?.financialAnalysis?.periodMetrics;

  return (
    <div
      className="news-modal-backdrop toss-holding-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="news-modal card toss-holding-modal"
        role="dialog"
        aria-modal="true"
        aria-label={ko.app.liveTradeTossHoldingManageAria}
      >
        <header className="toss-holding-modal__head">
          <LiveTradeSymbolCell
            symbol={holding.symbol}
            name={holding.name}
            market={market}
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            {ko.app.liveTradeCardModalClose}
          </button>
        </header>

        {loading ? (
          <p className="toss-holding-modal__muted">{ko.app.liveTradePfLoading}</p>
        ) : err && !report ? (
          <p className="toss-holding-modal__err" role="alert">
            {err}
          </p>
        ) : (
          <div className="toss-holding-modal__body">
            <section className="toss-holding-modal__section">
              <h3>{ko.app.liveTradeTossHoldingOverview}</h3>
              <dl className="toss-holding-modal__kv">
                <div>
                  <dt>{ko.app.liveTradeTossIndustry}</dt>
                  <dd>{report?.industry ?? "—"}</dd>
                </div>
                <div>
                  <dt>{ko.app.liveTradePfColQty}</dt>
                  <dd>{holding.quantity}</dd>
                </div>
                <div>
                  <dt>{ko.app.liveTradePfColAvg}</dt>
                  <dd>
                    {holding.avgBuyPrice != null
                      ? formatPrice(holding.avgBuyPrice, currency)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{ko.app.liveTradePfColCurrent}</dt>
                  <dd>
                    {holding.currentPrice != null
                      ? formatPrice(holding.currentPrice, currency)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>{ko.app.liveTradePfColPnl}</dt>
                  <dd>
                    {holding.returnPercent != null
                      ? formatPercent(holding.returnPercent)
                      : "—"}
                  </dd>
                </div>
              </dl>
            </section>

            {fund ? (
              <section className="toss-holding-modal__section">
                <h3>{ko.app.liveTradeTossFundamentals}</h3>
                <div className="toss-holding-modal__metrics">
                  <span>PER {fmtRatio(fund.per)}</span>
                  <span>PBR {fmtRatio(fund.pbr)}</span>
                  <span>ROE {fmtPctFrac(fund.roe)}</span>
                  <span>{ko.financials.profitMargin} {fmtPctFrac(fund.profitMargin)}</span>
                  <span>매출 성장 {fmtPctFrac(fund.revenueGrowth)}</span>
                  <span>{ko.financials.dividendYield} {fmtPctFrac(fund.dividendYield)}</span>
                  {peer?.peerGroup ? <span>동종: {peer.peerGroup}</span> : null}
                  {pm?.per != null && peer?.medianPer != null ? (
                    <span>
                      {ko.financials.peerMedianPer} {fmtRatio(peer.medianPer)}
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {ai ? (
              <section className="toss-holding-modal__section">
                <h3>{ko.app.liveTradeTossAiReport}</h3>
                <p className="toss-holding-modal__summary">{ai.summary}</p>
                <ul className="toss-holding-modal__bullets">
                  {ai.bullets.map((b) => (
                    <li key={b.slice(0, 48)}>{b}</li>
                  ))}
                </ul>
                <p className="toss-holding-modal__disclaimer">{ai.disclaimer}</p>
              </section>
            ) : null}

            {tech && !tech.insufficientData ? (
              <section className="toss-holding-modal__section">
                <h3>{ko.app.liveTradeTossTechnical}</h3>
                <p className="toss-holding-modal__tech">
                  {tech.buy ? ko.app.liveTradeTossTechBuyOn : ko.app.liveTradeTossTechBuyOff}{" "}
                  · {tech.conditionsMet}/{tech.conditionsTotal}{" "}
                  · {tech.scorePctLabel}%
                </p>
                <ul className="toss-holding-modal__signals">
                  {(tech.signalBreakdown ?? [])
                    .filter((s) => s.met)
                    .map((s) => (
                      <li key={s.id}>{s.label}</li>
                    ))}
                </ul>
              </section>
            ) : null}

            <section className="toss-holding-modal__section">
              <h3>{ko.app.liveTradeTossPlanTitle}</h3>
              {simulated ? (
                <p className="toss-holding-modal__sim">{ko.app.liveTradeTossOrderSimBanner}</p>
              ) : null}
              <div className="toss-holding-modal__plan-grid">
                <label>
                  <span>{ko.app.liveTradeTossTargetBuy}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={targetBuyPrice}
                    onChange={(e) => setTargetBuyPrice(e.target.value)}
                  />
                </label>
                <label>
                  <span>{ko.app.liveTradeTossTargetBuyAmount}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={targetBuyAmount}
                    onChange={(e) => setTargetBuyAmount(e.target.value)}
                  />
                </label>
                <label>
                  <span>{ko.app.liveTradeTossTargetSell}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={targetSellPrice}
                    onChange={(e) => setTargetSellPrice(e.target.value)}
                  />
                </label>
                <label>
                  <span>{ko.app.liveTradePfColStopLoss}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={stopLossPrice}
                    onChange={(e) => setStopLossPrice(e.target.value)}
                  />
                </label>
              </div>
              <label className="toss-holding-modal__notes">
                <span>{ko.app.liveTradeTossPlanNotes}</span>
                <textarea
                  className="input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div className="toss-holding-modal__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy}
                  onClick={() => void savePlan()}
                >
                  {ko.app.liveTradeTossPlanSave}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || simulated}
                  onClick={() => void runOrder("buy")}
                >
                  {ko.app.liveTradeTossLimitBuy}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={busy || simulated}
                  onClick={() => void runOrder("sell")}
                >
                  {ko.app.liveTradeTossLimitSell}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={busy || simulated}
                  onClick={() => void runOrder("stop")}
                >
                  {ko.app.liveTradeTossStopSell}
                </button>
              </div>
            </section>

            {msg ? (
              <p className="toss-holding-modal__msg" role="status">
                {msg}
              </p>
            ) : null}
            {err ? (
              <p className="toss-holding-modal__err" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
