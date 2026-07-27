import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTossRebalanceSchedule,
  runTossRebalanceSchedule,
  saveTossRebalanceSchedule,
  type TossRebalanceBuyPlan,
  type TossRebalanceSchedule,
} from "../api";
import { ko } from "../i18n/ko";
import { formatPercent, formatPrice } from "../lib/format";
import "./account-rebalance-schedule-modal.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatPlanMoney(amount: number, currency: "KRW" | "USD"): string {
  return formatPrice(amount, currency);
}

export default function AccountRebalanceScheduleModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [year] = useState(now.getFullYear());
  const [monthIndex] = useState(now.getMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [cashUsePct, setCashUsePct] = useState(100);
  const [markets, setMarkets] = useState<Array<"kr" | "us">>(["kr", "us"]);
  const [schedule, setSchedule] = useState<TossRebalanceSchedule | null>(null);
  const [plans, setPlans] = useState<TossRebalanceBuyPlan[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchTossRebalanceSchedule();
      const s = res.schedule;
      setSchedule(s);
      if (s) {
        setEnabled(Boolean(s.enabled));
        setDayOfMonth(s.dayOfMonth || 1);
        setCashUsePct(s.cashUsePct || 100);
        setMarkets(
          s.markets?.length ? s.markets : (["kr", "us"] as Array<"kr" | "us">),
        );
      }
      setPlans(res.preview?.plans ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dim = daysInMonth(year, monthIndex);
  const firstDow = new Date(year, monthIndex, 1).getDay();
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);

  const toggleMarket = (m: "kr" | "us") => {
    setMarkets((prev) => {
      if (prev.includes(m)) {
        const next = prev.filter((x) => x !== m);
        return next.length ? next : prev;
      }
      return [...prev, m];
    });
  };

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await saveTossRebalanceSchedule({
        enabled,
        dayOfMonth,
        cashUsePct,
        markets,
      });
      setSchedule(res.schedule);
      setPlans(res.preview?.plans ?? []);
      setMsg(ko.app.accountManageRebalanceSaved);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onPreviewRun = async () => {
    setRunning(true);
    setErr(null);
    setMsg(null);
    try {
      await saveTossRebalanceSchedule({
        enabled,
        dayOfMonth,
        cashUsePct,
        markets,
      });
      const res = await runTossRebalanceSchedule({ dryRun: true, force: true });
      setPlans(res.plans ?? []);
      const n = res.placed?.length ?? 0;
      setMsg(ko.app.accountManageRebalanceDryRunOk.replace("{n}", String(n)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const monthLabel = `${year}년 ${monthIndex + 1}월`;

  return (
    <div
      className="account-rebalance-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="account-rebalance-modal card"
        role="dialog"
        aria-modal="true"
        aria-label={ko.app.accountManageRebalanceTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="account-rebalance-modal__head">
          <div>
            <h2 className="account-rebalance-modal__title">
              {ko.app.accountManageRebalanceTitle}
            </h2>
            <p className="account-rebalance-modal__sub">
              {ko.app.accountManageRebalanceSubtitle}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
          >
            {ko.app.accountManageRebalanceClose}
          </button>
        </header>

        {loading ? (
          <p className="account-rebalance-modal__hint">
            {ko.app.accountManageRebalanceLoading}
          </p>
        ) : (
          <>
            <label className="account-rebalance-modal__enable">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>{ko.app.accountManageRebalanceEnable}</span>
            </label>

            <section className="account-rebalance-modal__cal" aria-label={monthLabel}>
              <div className="account-rebalance-modal__cal-head">{monthLabel}</div>
              <div className="account-rebalance-modal__weekday">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="account-rebalance-modal__grid">
                {cells.map((d, i) => {
                  if (d == null) {
                    return <span key={`e-${i}`} className="account-rebalance-modal__cell is-empty" />;
                  }
                  const selectable = d <= 28;
                  const active = selectable && d === dayOfMonth;
                  return (
                    <button
                      key={d}
                      type="button"
                      className={[
                        "account-rebalance-modal__cell",
                        selectable ? "" : "is-disabled",
                        active ? "is-active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={!selectable}
                      aria-pressed={active}
                      onClick={() => setDayOfMonth(d)}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="account-rebalance-modal__cal-hint">
                {ko.app.accountManageRebalanceDayHint.replace(
                  "{n}",
                  String(dayOfMonth),
                )}
              </p>
            </section>

            <div className="account-rebalance-modal__row">
              <span className="account-rebalance-modal__label">
                {ko.app.accountManageRebalanceMarkets}
              </span>
              <div className="account-rebalance-modal__chips">
                <button
                  type="button"
                  className={
                    markets.includes("kr")
                      ? "account-rebalance-modal__chip is-active"
                      : "account-rebalance-modal__chip"
                  }
                  aria-pressed={markets.includes("kr")}
                  onClick={() => toggleMarket("kr")}
                >
                  {ko.app.accountManageMarketKr}
                </button>
                <button
                  type="button"
                  className={
                    markets.includes("us")
                      ? "account-rebalance-modal__chip is-active"
                      : "account-rebalance-modal__chip"
                  }
                  aria-pressed={markets.includes("us")}
                  onClick={() => toggleMarket("us")}
                >
                  {ko.app.accountManageMarketUs}
                </button>
              </div>
            </div>

            <label className="account-rebalance-modal__row account-rebalance-modal__row--col">
              <span className="account-rebalance-modal__label">
                {ko.app.accountManageRebalanceCashPct.replace(
                  "{n}",
                  String(cashUsePct),
                )}
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={cashUsePct}
                onChange={(e) => setCashUsePct(Number(e.target.value))}
              />
            </label>

            <section className="account-rebalance-modal__preview">
              <h3>{ko.app.accountManageRebalancePreview}</h3>
              {plans.length === 0 ? (
                <p className="account-rebalance-modal__hint">
                  {ko.app.accountManageRebalancePreviewEmpty}
                </p>
              ) : (
                plans.map((plan) => (
                  <div key={plan.market} className="account-rebalance-modal__plan">
                    <div className="account-rebalance-modal__plan-head">
                      <strong>
                        {plan.market === "us"
                          ? ko.app.accountManageMarketUs
                          : ko.app.accountManageMarketKr}
                      </strong>
                      <span>
                        {ko.app.accountManageRebalanceCashUse
                          .replace(
                            "{avail}",
                            formatPlanMoney(plan.cashAvailable, plan.currency),
                          )
                          .replace(
                            "{spend}",
                            formatPlanMoney(plan.cashToSpend, plan.currency),
                          )}
                      </span>
                    </div>
                    {plan.orders.length === 0 ? (
                      <p className="account-rebalance-modal__hint">
                        {ko.app.accountManageRebalanceNoOrders}
                      </p>
                    ) : (
                      <ul>
                        {plan.orders.map((o) => (
                          <li key={`${plan.market}-${o.symbol}`}>
                            <span>
                              {o.symbol}
                              <em>{o.name}</em>
                            </span>
                            <span>
                              {formatPlanMoney(o.amount, plan.currency)}{" "}
                              ({formatPercent(o.weightPct).replace("+", "")})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </section>

            {schedule?.lastRunYmd ? (
              <p className="account-rebalance-modal__last">
                {ko.app.accountManageRebalanceLastRun
                  .replace("{ymd}", schedule.lastRunYmd)
                  .replace(
                    "{ok}",
                    schedule.lastResult?.ok
                      ? ko.app.accountManageRebalanceLastOk
                      : ko.app.accountManageRebalanceLastFail,
                  )}
              </p>
            ) : null}

            {err ? (
              <p className="account-rebalance-modal__err" role="alert">
                {err}
              </p>
            ) : null}
            {msg ? (
              <p className="account-rebalance-modal__msg" role="status">
                {msg}
              </p>
            ) : null}

            <footer className="account-rebalance-modal__foot">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={running || saving}
                onClick={() => void onPreviewRun()}
              >
                {ko.app.accountManageRebalanceDryRun}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={saving || running}
                onClick={() => void onSave()}
              >
                {saving
                  ? ko.app.accountManageRebalanceSaving
                  : ko.app.accountManageRebalanceSave}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
