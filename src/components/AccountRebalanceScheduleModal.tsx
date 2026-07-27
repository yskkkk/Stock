import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTossRebalanceSchedule,
  runTossRebalanceNow,
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

function cashLabelFor(currency: "KRW" | "USD"): string {
  return currency === "USD"
    ? ko.app.accountManageRebalanceCashUsd
    : ko.app.accountManageRebalanceCashKrw;
}

function planTitle(market: "kr" | "us"): string {
  return market === "us"
    ? ko.app.accountManageRebalancePlanUs
    : ko.app.accountManageRebalancePlanKr;
}

function planEmptyHint(plan: TossRebalanceBuyPlan): string {
  const cashLabel = cashLabelFor(plan.currency);
  const holdings = plan.holdingsCount ?? 0;
  if (plan.cashAvailable > 0 && holdings <= 0) {
    return ko.app.accountManageRebalanceNoHoldings.replace(
      "{cashLabel}",
      cashLabel,
    );
  }
  if (!(plan.cashAvailable > 0)) {
    return ko.app.accountManageRebalanceNoCash.replace("{cashLabel}", cashLabel);
  }
  return ko.app.accountManageRebalanceNoOrders;
}

export default function AccountRebalanceScheduleModal({
  onClose,
  onOrdersPlaced,
}: {
  onClose: () => void;
  onOrdersPlaced?: () => void;
}) {
  const now = useMemo(() => new Date(), []);
  const [year] = useState(now.getFullYear());
  const [monthIndex] = useState(now.getMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
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

  const onBuyNow = async () => {
    if (!window.confirm(ko.app.accountManageRebalanceNowConfirm)) return;
    setBuyingNow(true);
    setErr(null);
    setMsg(null);
    try {
      await saveTossRebalanceSchedule({
        enabled,
        dayOfMonth,
        cashUsePct,
        markets,
      });
      const res = await runTossRebalanceNow({
        dryRun: false,
        markets,
        cashUsePct,
      });
      setPlans(res.plans ?? []);
      const placed = res.placed?.length ?? 0;
      const failed = res.errors?.length ?? 0;
      if (placed === 0 && failed === 0) {
        setMsg(ko.app.accountManageRebalanceNowNone);
      } else if (failed > 0) {
        const detail = res.errors?.[0]?.error
          ? ` — ${res.errors[0].error}`
          : "";
        setErr(
          `${ko.app.accountManageRebalanceNowFail
            .replace("{ok}", String(placed))
            .replace("{total}", String(placed + failed))}${detail}`,
        );
        if (placed > 0) onOrdersPlaced?.();
      } else {
        setMsg(
          ko.app.accountManageRebalanceNowOk.replace("{n}", String(placed)),
        );
        onOrdersPlaced?.();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBuyingNow(false);
    }
  };

  const planByMarket = useMemo(() => {
    const map = new Map<string, TossRebalanceBuyPlan>();
    for (const p of plans) map.set(p.market, p);
    return map;
  }, [plans]);
  const cashSummary = useMemo(() => {
    const kr = plans.find((p) => p.currency === "KRW");
    const us = plans.find((p) => p.currency === "USD");
    return { kr, us };
  }, [plans]);

  const monthLabel = `${year}년 ${monthIndex + 1}월`;
  const krOn = markets.includes("kr");
  const usOn = markets.includes("us");

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

            <div className="account-rebalance-modal__row account-rebalance-modal__row--col">
              <span className="account-rebalance-modal__label">
                {ko.app.accountManageRebalanceMarkets}
              </span>
              <div className="account-rebalance-modal__chips">
                <button
                  type="button"
                  className={
                    krOn
                      ? "account-rebalance-modal__chip is-on"
                      : "account-rebalance-modal__chip is-off"
                  }
                  aria-pressed={krOn}
                  onClick={() => toggleMarket("kr")}
                >
                  <span className="account-rebalance-modal__chip-name">
                    {ko.app.accountManageMarketKr}
                  </span>
                  <span className="account-rebalance-modal__chip-cur">원화</span>
                  <span
                    className={
                      krOn
                        ? "account-rebalance-modal__chip-state is-on"
                        : "account-rebalance-modal__chip-state is-off"
                    }
                  >
                    {krOn
                      ? ko.app.accountManageRebalanceMarketOn
                      : ko.app.accountManageRebalanceMarketOff}
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    usOn
                      ? "account-rebalance-modal__chip is-on"
                      : "account-rebalance-modal__chip is-off"
                  }
                  aria-pressed={usOn}
                  onClick={() => toggleMarket("us")}
                >
                  <span className="account-rebalance-modal__chip-name">
                    {ko.app.accountManageMarketUs}
                  </span>
                  <span className="account-rebalance-modal__chip-cur">달러</span>
                  <span
                    className={
                      usOn
                        ? "account-rebalance-modal__chip-state is-on"
                        : "account-rebalance-modal__chip-state is-off"
                    }
                  >
                    {usOn
                      ? ko.app.accountManageRebalanceMarketOn
                      : ko.app.accountManageRebalanceMarketOff}
                  </span>
                </button>
              </div>
              <p className="account-rebalance-modal__hint">
                {ko.app.accountManageRebalanceMarketHint}
              </p>
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

            {(cashSummary.kr || cashSummary.us) && (
              <section
                className="account-rebalance-modal__cash-sum"
                aria-label={ko.app.accountManageRebalanceCashSummary}
              >
                <div className="account-rebalance-modal__cash-sum-title">
                  {ko.app.accountManageRebalanceCashSummary}
                </div>
                <div className="account-rebalance-modal__cash-sum-row">
                  <span className="account-rebalance-modal__badge is-krw">원</span>
                  <span>{ko.app.accountManageRebalanceCashKrw}</span>
                  <strong>
                    {cashSummary.kr
                      ? formatPlanMoney(cashSummary.kr.cashAvailable, "KRW")
                      : "—"}
                  </strong>
                </div>
                <div className="account-rebalance-modal__cash-sum-row">
                  <span className="account-rebalance-modal__badge is-usd">$</span>
                  <span>{ko.app.accountManageRebalanceCashUsd}</span>
                  <strong>
                    {cashSummary.us
                      ? formatPlanMoney(cashSummary.us.cashAvailable, "USD")
                      : "—"}
                  </strong>
                </div>
              </section>
            )}

            <section className="account-rebalance-modal__preview">
              <h3>{ko.app.accountManageRebalancePreview}</h3>
              {(["kr", "us"] as const).map((m) => {
                const on = markets.includes(m);
                const plan = planByMarket.get(m);
                return (
                  <div
                    key={m}
                    className={[
                      "account-rebalance-modal__plan",
                      on ? "" : "is-off",
                      m === "us" ? "is-usd" : "is-krw",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="account-rebalance-modal__plan-head">
                      <strong>
                        <span
                          className={[
                            "account-rebalance-modal__badge",
                            m === "us" ? "is-usd" : "is-krw",
                          ].join(" ")}
                        >
                          {m === "us" ? "$" : "원"}
                        </span>
                        {planTitle(m)}
                      </strong>
                      {!on ? (
                        <span className="account-rebalance-modal__off-tag">
                          {ko.app.accountManageRebalanceMarketOff}
                        </span>
                      ) : plan ? (
                        <span>
                          {ko.app.accountManageRebalanceCashUse
                            .replace("{cashLabel}", cashLabelFor(plan.currency))
                            .replace(
                              "{avail}",
                              formatPlanMoney(plan.cashAvailable, plan.currency),
                            )
                            .replace(
                              "{spend}",
                              formatPlanMoney(plan.cashToSpend, plan.currency),
                            )}
                        </span>
                      ) : null}
                    </div>
                    {!on ? (
                      <p className="account-rebalance-modal__hint">
                        {ko.app.accountManageRebalanceMarketOffHint}
                      </p>
                    ) : !plan ? (
                      <p className="account-rebalance-modal__hint">
                        {ko.app.accountManageRebalancePreviewEmpty}
                      </p>
                    ) : plan.orders.length === 0 ? (
                      <p className="account-rebalance-modal__hint">
                        {planEmptyHint(plan)}
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
                );
              })}
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
                disabled={running || saving || buyingNow}
                onClick={() => void onPreviewRun()}
              >
                {ko.app.accountManageRebalanceDryRun}
              </button>
              <button
                type="button"
                className="btn btn--primary account-rebalance-modal__buy-now"
                disabled={saving || running || buyingNow}
                onClick={() => void onBuyNow()}
              >
                {buyingNow
                  ? ko.app.accountManageRebalanceNowRunning
                  : ko.app.accountManageRebalanceNowRun}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={saving || running || buyingNow}
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
