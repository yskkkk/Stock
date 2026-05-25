import type { LiveTradeHolding } from "../api";
import { useTossPortfolioBalance } from "../hooks/useTossPortfolioBalance";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { LiveTradeSymbolCellFromHolding } from "./LiveTradeSymbolCell";
import { ko } from "../i18n/ko";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";

function holdingReturnPct(h: LiveTradeHolding): number | null {
  if (h.changePct != null && Number.isFinite(h.changePct)) return h.changePct;
  const avg = h.avgEntryPrice;
  const cur = h.currentPrice;
  if (!(avg > 0) || cur == null || !(cur > 0)) return null;
  const pct = ((cur - avg) / avg) * 100;
  return Number.isFinite(pct) ? pct : null;
}

export default function TossAccountBalancePanel({
  feeLabelKo,
}: {
  feeLabelKo?: string | null;
}) {
  const { authChecked, user, holdings, updatedAtMs, loading, err, unrealKrw } =
    useTossPortfolioBalance();

  if (authChecked && !user) return null;

  if (!authChecked || loading) {
    return <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />;
  }

  if (err) {
    return <p className="dock-linked-accounts__hint">{err}</p>;
  }

  const feesLine = feeLabelKo
    ? `${ko.app.liveTradeFeeLabel}: ${feeLabelKo}`
    : null;

  return (
    <div
      className="live-trading-tab__cred-snapshot toss-account-balance"
      aria-label={ko.app.liveTradeTossAccountSectionAria}
    >
      {feesLine ? (
        <p className="live-trading-tab__cred-snapshot-fees">{feesLine}</p>
      ) : null}
      <p className="dock-linked-accounts__hint dock-linked-accounts__hint--note">
        {ko.app.liveTradeTossBalanceNote}
      </p>
      {updatedAtMs != null ? (
        <p className="dock-linked-accounts__summary">
          {ko.app.liveTradePfUpdated}{" "}
          {new Date(updatedAtMs).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}
        </p>
      ) : null}
      {unrealKrw != null && Number.isFinite(unrealKrw) ? (
        <p className="toss-account-balance__unreal">
          {ko.app.liveTradePfUnrealized}{" "}
          <span
            className={
              unrealKrw >= 0
                ? "toss-account-balance__unreal--up"
                : "toss-account-balance__unreal--down"
            }
          >
            {formatSignedMoney(unrealKrw, "KRW")}
          </span>
        </p>
      ) : null}
      <p className="live-trading-tab__cred-snapshot-title">
        {ko.app.liveTradeCredTestHoldings}
      </p>
      {holdings.length === 0 ? (
        <p className="live-trading-tab__cred-snapshot-empty">
          {ko.app.liveTradePfNoHoldings}
        </p>
      ) : (
        <ul className="live-trading-tab__cred-snapshot-holdings toss-account-balance__list">
          {holdings.map((h) => {
            const ret = holdingReturnPct(h);
            return (
              <li key={`${h.programId}-${h.symbol}`}>
                <div className="live-trading-tab__cred-snapshot-holding-row">
                  <LiveTradeSymbolCellFromHolding h={h} />
                  {ret != null ? (
                    <span
                      className={`live-trading-tab__cred-snapshot-chg live-trading-tab__cred-snapshot-chg--${
                        ret > 0 ? "up" : ret < 0 ? "down" : "flat"
                      }`}
                    >
                      {formatPercent(ret)}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
