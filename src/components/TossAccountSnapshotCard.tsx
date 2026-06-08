import type { TossTestSnapshot } from "../api";
import { ko } from "../i18n/ko";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";

function formatUpdatedHmSs(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function TossAccountSnapshotCard({
  snapshot,
  feeLabelKo,
  updatedAtMs = null,
  variant = "inline",
  authenticated = true,
}: {
  snapshot: TossTestSnapshot;
  feeLabelKo?: string | null;
  updatedAtMs?: number | null;
  variant?: "inline" | "rail";
  authenticated?: boolean;
}) {
  const { cash, summary, holdings } = snapshot;
  const [balanceHidden, toggleBalanceHidden] = useBithumbBalanceHidden();
  const rootClass = [
    variant === "rail" ? "bithumb-account-rail" : "live-trading-tab__cred-snapshot",
    authenticated ? "" : "live-trading-tab__cred-snapshot--unauth",
    "toss-account-snapshot",
  ]
    .filter(Boolean)
    .join(" ");

  const feesLine = feeLabelKo ? `${ko.app.liveTradeFeeLabel}: ${feeLabelKo}` : null;

  return (
    <div className={rootClass} aria-label={ko.app.liveTradeTossAccountSectionAria}>
      {feesLine ? (
        <p
          className={
            variant === "rail"
              ? "bithumb-account-rail__fees"
              : "live-trading-tab__cred-snapshot-fees"
          }
        >
          {feesLine}
        </p>
      ) : null}
      {variant === "rail" && updatedAtMs != null && Number.isFinite(updatedAtMs) ? (
        <p className="bithumb-account-rail__updated">
          {ko.app.leftRailTossUpdated}{" "}
          <time dateTime={new Date(updatedAtMs).toISOString()}>
            {formatUpdatedHmSs(updatedAtMs)}
          </time>
        </p>
      ) : null}
      <div
        className={
          variant === "rail"
            ? "bithumb-account-rail__balance-head"
            : "live-trading-tab__cred-snapshot-balance-head"
        }
      >
        <p
          className={
            variant === "rail"
              ? "bithumb-account-rail__section-title bithumb-account-rail__section-title--inline"
              : "live-trading-tab__cred-snapshot-title live-trading-tab__cred-snapshot-title--inline"
          }
        >
          {ko.app.liveTradeCredTestBalance}
        </p>
        <button
          type="button"
          className="bithumb-balance-hide-btn"
          onClick={toggleBalanceHidden}
          aria-pressed={balanceHidden}
        >
          {balanceHidden
            ? ko.app.leftRailBithumbBalanceShow
            : ko.app.leftRailBithumbBalanceHide}
        </button>
      </div>
      <dl
        className={`live-trading-tab__cred-snapshot-krw live-trading-tab__cred-snapshot-krw--pair bithumb-account-rail__krw${
          balanceHidden ? " bithumb-balance-values--hidden" : ""
        }`}
      >
        <div>
          <dt>{ko.app.liveTradeTossCashKrw}</dt>
          <dd aria-hidden={balanceHidden || undefined}>{formatPrice(cash.krw, "KRW")}</dd>
        </div>
        {cash.usd > 0 ? (
          <div>
            <dt>{ko.app.liveTradeTossCashUsd}</dt>
            <dd aria-hidden={balanceHidden || undefined}>{formatPrice(cash.usd, "USD")}</dd>
          </div>
        ) : null}
      </dl>
      {summary?.profitLossKrw != null && Number.isFinite(summary.profitLossKrw) ? (
        <p className="toss-account-snapshot__pl">
          {ko.app.liveTradePfUnrealized}{" "}
          <span
            className={
              summary.profitLossKrw >= 0
                ? "toss-account-balance__unreal--up"
                : "toss-account-balance__unreal--down"
            }
          >
            {formatSignedMoney(summary.profitLossKrw, "KRW")}
          </span>
        </p>
      ) : null}
      {variant !== "rail" ? (
        <>
          <p className="live-trading-tab__cred-snapshot-title">
            {ko.app.liveTradeCredTestHoldings}
          </p>
          {holdings.length === 0 ? (
            <p className="live-trading-tab__cred-snapshot-empty">
              {ko.app.liveTradePfNoHoldings}
            </p>
          ) : (
            <ul className="live-trading-tab__cred-snapshot-holdings toss-account-balance__list">
              {holdings.map((h) => (
                <li key={`${h.market}-${h.symbol}`}>
                  <div className="live-trading-tab__cred-snapshot-holding-row">
                    <LiveTradeSymbolCell
                      symbol={h.symbol}
                      name={h.name}
                      market={h.market}
                      className="live-trading-tab__cred-snapshot-coin"
                    />
                    {h.returnPercent != null ? (
                      <span
                        className={`live-trading-tab__cred-snapshot-chg live-trading-tab__cred-snapshot-chg--${
                          h.returnPercent > 0
                            ? "up"
                            : h.returnPercent < 0
                              ? "down"
                              : "flat"
                        }`}
                      >
                        {formatPercent(h.returnPercent)}
                      </span>
                    ) : null}
                  </div>
                  <div className="live-trading-tab__cred-snapshot-holding-row">
                    <span className="live-trading-tab__cred-snapshot-qty">
                      {formatLiveTradeQuantity(h.quantity, h.market)}
                    </span>
                    {h.marketValue != null ? (
                      <span className="live-trading-tab__cred-snapshot-val">
                        {formatPrice(h.marketValue, h.currency)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
