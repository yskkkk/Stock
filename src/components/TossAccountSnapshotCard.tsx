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

function holdingChgTone(pct: number | null | undefined): "up" | "down" | "flat" {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
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
  const isRail = variant === "rail";
  const rootClass = [
    "account-snapshot",
    "toss-account-snapshot",
    isRail ? "account-snapshot--rail bithumb-account-rail" : "live-trading-tab__cred-snapshot",
    authenticated ? "" : "live-trading-tab__cred-snapshot--unauth",
  ]
    .filter(Boolean)
    .join(" ");

  const feesLine = feeLabelKo?.trim() || null;
  const plKrw =
    summary?.profitLossKrw != null && Number.isFinite(summary.profitLossKrw)
      ? summary.profitLossKrw
      : null;
  const plUp = plKrw != null && plKrw >= 0;

  return (
    <div className={rootClass} aria-label={ko.app.liveTradeTossAccountSectionAria}>
      {feesLine || (isRail && updatedAtMs != null && Number.isFinite(updatedAtMs)) ? (
        <div className="account-snapshot__meta">
          {feesLine ? (
            <span className="account-snapshot__fees" title={feesLine}>
              {ko.app.liveTradeFeeLabel}: {feesLine}
            </span>
          ) : (
            <span />
          )}
          {isRail && updatedAtMs != null && Number.isFinite(updatedAtMs) ? (
            <span className="account-snapshot__updated">
              {ko.app.leftRailTossUpdated}{" "}
              <time dateTime={new Date(updatedAtMs).toISOString()}>
                {formatUpdatedHmSs(updatedAtMs)}
              </time>
            </span>
          ) : null}
        </div>
      ) : null}

      <section
        className={`account-snapshot__balance-card${
          balanceHidden ? " account-snapshot__values--hidden" : ""
        }`}
      >
        <header className="account-snapshot__balance-head">
          <h3 className="account-snapshot__balance-title">
            {ko.app.liveTradeCredTestBalance}
          </h3>
          <button
            type="button"
            className="account-snapshot__hide-btn"
            onClick={toggleBalanceHidden}
            aria-pressed={balanceHidden}
          >
            {balanceHidden
              ? ko.app.leftRailBithumbBalanceShow
              : ko.app.leftRailBithumbBalanceHide}
          </button>
        </header>

        <div className="account-snapshot__cash-grid">
          <div className="account-snapshot__cash-item">
            <span className="account-snapshot__cash-label">
              {ko.app.liveTradeTossCashKrw}
            </span>
            <span className="account-snapshot__cash-value" aria-hidden={balanceHidden || undefined}>
              {formatPrice(cash.krw, "KRW")}
            </span>
          </div>
          {cash.usd > 0 ? (
            <div className="account-snapshot__cash-item">
              <span className="account-snapshot__cash-label">
                {ko.app.liveTradeTossCashUsd}
              </span>
              <span className="account-snapshot__cash-value" aria-hidden={balanceHidden || undefined}>
                {formatPrice(cash.usd, "USD")}
              </span>
            </div>
          ) : null}
        </div>

        {plKrw != null ? (
          <div className="account-snapshot__pl">
            <span className="account-snapshot__pl-label">
              {ko.app.liveTradePfUnrealized}
            </span>
            <span
              className={`account-snapshot__pl-value ${
                plUp ? "account-snapshot__pl-value--up" : "account-snapshot__pl-value--down"
              }`}
              aria-hidden={balanceHidden || undefined}
            >
              {formatSignedMoney(plKrw, "KRW")}
            </span>
          </div>
        ) : null}
      </section>

      <section className="account-snapshot__holdings">
        <div className="account-snapshot__holdings-head">
          <h3 className="account-snapshot__holdings-title">
            {ko.app.liveTradeCredTestHoldings}
          </h3>
          {holdings.length > 0 ? (
            <span className="account-snapshot__holdings-count">{holdings.length}</span>
          ) : null}
        </div>
        {holdings.length === 0 ? (
          <p className="account-snapshot__empty">{ko.app.liveTradePfNoHoldings}</p>
        ) : (
          <ul className="account-snapshot__holdings-list">
            {holdings.map((h) => {
              const tone = holdingChgTone(h.returnPercent);
              return (
                <li key={`${h.market}-${h.symbol}`} className="account-snapshot__holding">
                  <div className="account-snapshot__holding-row">
                    <LiveTradeSymbolCell
                      symbol={h.symbol}
                      name={h.name}
                      market={h.market}
                      className="account-snapshot__holding-name"
                    />
                    {h.returnPercent != null ? (
                      <span
                        className={`account-snapshot__holding-chg account-snapshot__holding-chg--${tone}`}
                      >
                        {formatPercent(h.returnPercent)}
                      </span>
                    ) : null}
                  </div>
                  <div className="account-snapshot__holding-row">
                    <span className="account-snapshot__holding-qty">
                      {formatLiveTradeQuantity(h.quantity, h.market)}
                    </span>
                    {h.marketValue != null ? (
                      <span className="account-snapshot__holding-val">
                        {formatPrice(h.marketValue, h.currency)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
