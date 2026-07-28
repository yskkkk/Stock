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
import {
  anySelectedMarketRegularOpen,
  isMarketRegularOpenClient,
} from "../lib/marketRegularHours";
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

function marketName(market: "kr" | "us"): string {
  return market === "us"
    ? ko.app.accountManageMarketUs
    : ko.app.accountManageMarketKr;
}

function currencyBadgeLabel(market: "kr" | "us"): string {
  return market === "us" ? "$" : "원";
}

function currencyShortLabel(market: "kr" | "us"): string {
  return market === "us"
    ? ko.app.accountManageCurrencyUsd
    : ko.app.accountManageCurrencyKrw;
}

function marketHoursLabel(market: "kr" | "us"): string {
  return isMarketRegularOpenClient(market)
    ? ko.app.accountManageRebalanceMarketRegularOpen
    : ko.app.accountManageRebalanceMarketRegularClosed;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [cashUsePct, setCashUsePct] = useState(100);
  const [markets, setMarkets] = useState<Array<"kr" | "us">>(["kr", "us"]);
  const [schedule, setSchedule] = useState<TossRebalanceSchedule | null>(null);
  const [plans, setPlans] = useState<TossRebalanceBuyPlan[]>([]);
  const [, setHoursTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setHoursTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
      setLoadError(e instanceof Error ? e.message : String(e));
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
    if (!anySelectedMarketRegularOpen(markets)) {
      setErr(ko.app.accountManageRebalanceNowHoursBlocked);
      return;
    }
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
      if (!res.ok) {
        setErr(res.error || ko.app.accountManageRebalanceNowHoursBlocked);
        return;
      }
      setPlans(res.plans ?? []);
      const placed = res.placed?.length ?? 0;
      const failed = res.errors?.length ?? 0;
      const skipped = res.skippedMarkets ?? [];
      const skipNote =
        skipped.length > 0
          ? ` ${ko.app.accountManageRebalanceNowSkipped.replace(
              "{markets}",
              skipped
                .map((m) =>
                  m === "us"
                    ? ko.app.accountManageMarketUs
                    : ko.app.accountManageMarketKr,
                )
                .join(", "),
            )}`
          : "";
      if (placed === 0 && failed === 0) {
        setMsg(`${ko.app.accountManageRebalanceNowNone}${skipNote}`);
      } else if (failed > 0) {
        const detail = res.errors?.[0]?.error
          ? ` — ${res.errors[0].error}`
          : "";
        setErr(
          `${ko.app.accountManageRebalanceNowFail
            .replace("{ok}", String(placed))
            .replace("{total}", String(placed + failed))}${detail}${skipNote}`,
        );
        if (placed > 0) onOrdersPlaced?.();
      } else {
        setMsg(
          `${ko.app.accountManageRebalanceNowOk.replace("{n}", String(placed))}${skipNote}`,
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
  const buyNowAllowed = anySelectedMarketRegularOpen(markets);

  const renderMarketChip = (m: "kr" | "us") => {
    const on = markets.includes(m);
    const hoursOpen = isMarketRegularOpenClient(m);
    const name = marketName(m);
    return (
      <button
        key={m}
        type="button"
        className={[
          "account-rebalance-modal__chip",
          on ? "is-on" : "is-off",
          m === "us" ? "is-usd" : "is-krw",
        ].join(" ")}
        aria-pressed={on}
        aria-label={`${name} ${currencyShortLabel(m)} ${on ? ko.app.accountManageRebalanceMarketOn : ko.app.accountManageRebalanceMarketOff} ${marketHoursLabel(m)}`}
        onClick={() => toggleMarket(m)}
      >
        <span className="account-rebalance-modal__chip-top">
          <span
            className={[
              "account-rebalance-modal__badge",
              m === "us" ? "is-usd" : "is-krw",
            ].join(" ")}
          >
            {currencyBadgeLabel(m)}
          </span>
          <span className="account-rebalance-modal__chip-name">{name}</span>
          <span className="account-rebalance-modal__chip-cur">
            {currencyShortLabel(m)}
          </span>
        </span>
        <span className="account-rebalance-modal__chip-meta">
          <span className="account-rebalance-modal__chip-meta-row">
            <span className="account-rebalance-modal__chip-meta-label">
              {ko.app.accountManageRebalanceMarketScheduleLabel}
            </span>
            <span
              className={[
                "account-rebalance-modal__chip-state",
                on ? "is-on" : "is-off",
              ].join(" ")}
            >
              {on
                ? ko.app.accountManageRebalanceMarketOn
                : ko.app.accountManageRebalanceMarketOff}
            </span>
          </span>
          <span className="account-rebalance-modal__chip-meta-row">
            <span className="account-rebalance-modal__chip-meta-label">
              {ko.app.accountManageRebalanceMarketSessionLabel}
            </span>
            <span
              className={[
                "account-rebalance-modal__chip-hours",
                hoursOpen ? "is-open" : "is-closed",
              ].join(" ")}
            >
              {marketHoursLabel(m)}
            </span>
          </span>
        </span>
      </button>
    );
  };

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
        data-vu="account-rebalance-modal"
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
            data-vu="account-rebalance-close"
            onClick={onClose}
          >
            {ko.app.accountManageRebalanceClose}
          </button>
        </header>

        <div data-vu="account-rebalance-ready">
          {loading ? (
            <p
              className="account-rebalance-modal__hint"
              data-vu="account-rebalance-loading"
              role="status"
              aria-live="polite"
            >
              {ko.app.accountManageRebalanceLoading}
            </p>
          ) : loadError ? (
            <div
              className="account-rebalance-modal__load-err"
              data-vu="account-rebalance-load-err"
            >
              <p className="account-rebalance-modal__err" role="alert">
                {loadError}
              </p>
              <p className="account-rebalance-modal__hint">
                {ko.app.accountManageRebalanceLoadErrHint}
              </p>
              <button
                type="button"
                className="btn btn--primary account-rebalance-modal__retry"
                data-vu="account-rebalance-retry"
                disabled={loading}
                onClick={() => void load()}
              >
                {ko.app.accountManageRebalanceRetry}
              </button>
            </div>
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
                {renderMarketChip("kr")}
                {renderMarketChip("us")}
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

            <section
              className="account-rebalance-modal__cash-sum"
              aria-label={ko.app.accountManageRebalanceCashSummary}
            >
                <div className="account-rebalance-modal__cash-sum-title">
                  {ko.app.accountManageRebalanceCashSummary}
                </div>
                <div className="account-rebalance-modal__cash-sum-grid">
                  {(["kr", "us"] as const).map((m) => {
                    const plan = m === "kr" ? cashSummary.kr : cashSummary.us;
                    const currency = m === "us" ? "USD" : "KRW";
                    return (
                      <div
                        key={m}
                        className={[
                          "account-rebalance-modal__cash-sum-box",
                          m === "us" ? "is-usd" : "is-krw",
                        ].join(" ")}
                      >
                        <div className="account-rebalance-modal__cash-sum-box-head">
                          <span
                            className={[
                              "account-rebalance-modal__badge",
                              m === "us" ? "is-usd" : "is-krw",
                            ].join(" ")}
                          >
                            {currencyBadgeLabel(m)}
                          </span>
                          <span>{marketName(m)}</span>
                          <span className="account-rebalance-modal__chip-cur">
                            {currencyShortLabel(m)}
                          </span>
                        </div>
                        <strong>
                          {plan
                            ? formatPlanMoney(plan.cashAvailable, currency)
                            : "—"}
                        </strong>
                        <span className="account-rebalance-modal__cash-sum-box-label">
                          {cashLabelFor(currency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

            <section className="account-rebalance-modal__preview">
              <h3>{ko.app.accountManageRebalancePreview}</h3>
              <p className="account-rebalance-modal__hint account-rebalance-modal__preview-hint">
                {ko.app.accountManageRebalancePreviewHint}
              </p>
              {(["kr", "us"] as const).map((m) => {
                const on = markets.includes(m);
                const plan = planByMarket.get(m);
                const hoursOpen = isMarketRegularOpenClient(m);
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
                      <div className="account-rebalance-modal__plan-head-main">
                        <span
                          className={[
                            "account-rebalance-modal__badge",
                            m === "us" ? "is-usd" : "is-krw",
                          ].join(" ")}
                        >
                          {currencyBadgeLabel(m)}
                        </span>
                        <strong>{planTitle(m)}</strong>
                        <span className="account-rebalance-modal__chip-cur">
                          {currencyShortLabel(m)}
                        </span>
                      </div>
                      <div className="account-rebalance-modal__plan-head-meta">
                        <span className="account-rebalance-modal__chip-meta-row">
                          <span className="account-rebalance-modal__chip-meta-label">
                            {ko.app.accountManageRebalanceMarketScheduleLabel}
                          </span>
                          <span
                            className={[
                              "account-rebalance-modal__chip-state",
                              on ? "is-on" : "is-off",
                            ].join(" ")}
                          >
                            {on
                              ? ko.app.accountManageRebalanceMarketOn
                              : ko.app.accountManageRebalanceMarketOff}
                          </span>
                        </span>
                        <span className="account-rebalance-modal__chip-meta-row">
                          <span className="account-rebalance-modal__chip-meta-label">
                            {ko.app.accountManageRebalanceMarketSessionLabel}
                          </span>
                          <span
                            className={[
                              "account-rebalance-modal__chip-hours",
                              hoursOpen ? "is-open" : "is-closed",
                            ].join(" ")}
                          >
                            {marketHoursLabel(m)}
                          </span>
                        </span>
                      </div>
                      {on && plan ? (
                        <p className="account-rebalance-modal__plan-cash">
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
                        </p>
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

            <p className="account-rebalance-modal__hint account-rebalance-modal__foot-hint">
              {ko.app.accountManageRebalanceNowHoursHint}
            </p>

            <footer className="account-rebalance-modal__foot">
              <button
                type="button"
                className="btn btn--ghost"
                data-vu="account-rebalance-dry-run"
                disabled={running || saving || buyingNow}
                onClick={() => void onPreviewRun()}
              >
                {ko.app.accountManageRebalanceDryRun}
              </button>
              <button
                type="button"
                className="btn btn--primary account-rebalance-modal__buy-now"
                data-vu="account-rebalance-buy-now"
                disabled={saving || running || buyingNow || !buyNowAllowed}
                title={
                  buyNowAllowed
                    ? undefined
                    : ko.app.accountManageRebalanceNowHoursHint
                }
                onClick={() => void onBuyNow()}
              >
                {buyingNow
                  ? ko.app.accountManageRebalanceNowRunning
                  : ko.app.accountManageRebalanceNowRun}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                data-vu="account-rebalance-save"
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
    </div>
  );
}
