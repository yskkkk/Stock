import { useRef, useState } from "react";
import { useStickyNumber } from "../hooks/useStickyNumber";
import type { TossTestHolding, TossTestSnapshot } from "../api";
import { ko } from "../i18n/ko";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { useTossSnapshotLiveQuotes } from "../hooks/useTossSnapshotLiveQuotes";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";
import TossAccountOrderPanel, {
  type TossAccountOrderPanelHandle,
} from "./TossAccountOrderPanel";
import TossHoldingManageModal from "./TossHoldingManageModal";
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

function holdingUnrealizedPnl(h: TossTestHolding): number | null {
  const avg = h.avgBuyPrice;
  const qty = h.quantity;
  if (avg == null || !(avg > 0) || !(qty > 0)) return null;
  const cost = avg * qty;
  const mv =
    h.marketValue != null && Number.isFinite(h.marketValue)
      ? h.marketValue
      : h.currentPrice != null && Number.isFinite(h.currentPrice) && h.currentPrice > 0
        ? h.currentPrice * qty
        : null;
  if (mv == null) return null;
  const pnl = mv - cost;
  return Number.isFinite(pnl) ? pnl : null;
}

function pnlTone(pnl: number | null | undefined): "up" | "down" | "flat" {
  if (pnl == null || !Number.isFinite(pnl)) return "flat";
  if (pnl > 0) return "up";
  if (pnl < 0) return "down";
  return "flat";
}

export default function TossAccountSnapshotCard({
  snapshot,
  feeLabelKo,
  updatedAtMs = null,
  variant = "inline",
  authenticated = true,
  liveOrdersEnabled = false,
  serverLiveOrdersEnabled = false,
  showOrders = true,
  onOrderChanged,
}: {
  snapshot: TossTestSnapshot;
  feeLabelKo?: string | null;
  updatedAtMs?: number | null;
  variant?: "inline" | "rail";
  authenticated?: boolean;
  liveOrdersEnabled?: boolean;
  serverLiveOrdersEnabled?: boolean;
  showOrders?: boolean;
  onOrderChanged?: () => void;
}) {
  const liveSnapshot = useTossSnapshotLiveQuotes(
    snapshot,
    Boolean(snapshot.holdings?.length),
  );
  const { cash, summary, holdings } = liveSnapshot ?? snapshot;
  const orderPanelRef = useRef<TossAccountOrderPanelHandle>(null);
  const [manageHolding, setManageHolding] = useState<TossTestHolding | null>(null);
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
  const plKrw = useStickyNumber(
    summary?.profitLossKrw != null && Number.isFinite(summary.profitLossKrw)
      ? summary.profitLossKrw
      : null,
  );
  const plUp = plKrw != null && plKrw >= 0;
  const returnPct = useStickyNumber(
    summary?.totalReturnPct != null && Number.isFinite(summary.totalReturnPct)
      ? summary.totalReturnPct
      : null,
  );
  const retUp = returnPct != null && returnPct >= 0;
  const cashKrw = useStickyNumber(
    cash?.krw != null && Number.isFinite(cash.krw) ? cash.krw : null,
  );

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
              {formatPrice(cashKrw ?? cash.krw, "KRW")}
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
        {returnPct != null ? (
          <div className="account-snapshot__pl account-snapshot__pl--compact">
            <span className="account-snapshot__pl-label">
              {ko.app.liveTradePfReturn}
            </span>
            <span
              className={`account-snapshot__pl-value ${
                retUp ? "account-snapshot__pl-value--up" : "account-snapshot__pl-value--down"
              }`}
              aria-hidden={balanceHidden || undefined}
            >
              {formatPercent(returnPct)}
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
              const unrealizedPnl = holdingUnrealizedPnl(h);
              const pnlUpDown = pnlTone(unrealizedPnl);
              const hasAvg =
                h.avgBuyPrice != null &&
                Number.isFinite(h.avgBuyPrice) &&
                h.avgBuyPrice > 0;
              const hasCur =
                h.currentPrice != null &&
                Number.isFinite(h.currentPrice) &&
                h.currentPrice > 0;
              return (
                <li key={`${h.market}-${h.symbol}`} className="account-snapshot__holding">
                  <div className="account-snapshot__holding-row">
                    <button
                      type="button"
                      className="account-snapshot__holding-open"
                      onClick={() => setManageHolding(h)}
                    >
                      <LiveTradeSymbolCell
                        symbol={h.symbol}
                        name={h.name}
                        market={h.market}
                        className="account-snapshot__holding-name"
                      />
                    </button>
                    {unrealizedPnl != null || h.returnPercent != null ? (
                      <span className="account-snapshot__holding-pnl-wrap">
                        {unrealizedPnl != null ? (
                          <span
                            className={`account-snapshot__holding-pnl account-snapshot__holding-pnl--${pnlUpDown}`}
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatSignedMoney(unrealizedPnl, h.currency)}
                          </span>
                        ) : null}
                        {h.returnPercent != null ? (
                          <span
                            className={`account-snapshot__holding-chg account-snapshot__holding-chg--${tone}`}
                          >
                            {formatPercent(h.returnPercent)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  <div className="account-snapshot__holding-row">
                    <span className="account-snapshot__holding-qty">
                      {formatLiveTradeQuantity(h.quantity, h.market)}주
                    </span>
                    {h.marketValue != null ? (
                      <span className="account-snapshot__holding-val">
                        {formatPrice(h.marketValue, h.currency)}
                      </span>
                    ) : null}
                    {showOrders && authenticated ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm account-snapshot__manage-btn"
                          onClick={() => setManageHolding(h)}
                        >
                          {ko.app.liveTradeTossHoldingManage}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm account-snapshot__sell-btn"
                          onClick={() => orderPanelRef.current?.openSell(h)}
                        >
                          {ko.app.liveTradeTossOrderSell}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {hasAvg || hasCur ? (
                    <div className="account-snapshot__holding-prices">
                      {hasAvg ? (
                        <span>
                          {ko.app.liveTradePfColAvg}{" "}
                          {formatPrice(h.avgBuyPrice!, h.currency)}
                        </span>
                      ) : null}
                      {hasAvg && hasCur ? (
                        <span className="account-snapshot__holding-prices-sep">·</span>
                      ) : null}
                      {hasCur ? (
                        <span>
                          {ko.app.liveTradePfColCurrent}{" "}
                          {formatPrice(h.currentPrice!, h.currency)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {showOrders && authenticated ? (
        <TossAccountOrderPanel
          ref={orderPanelRef}
          compact={isRail}
          liveOrdersEnabled={liveOrdersEnabled}
          serverLiveOrdersEnabled={serverLiveOrdersEnabled}
          onChanged={onOrderChanged}
        />
      ) : null}

      {manageHolding ? (
        <TossHoldingManageModal
          holding={manageHolding}
          liveOrdersEnabled={liveOrdersEnabled}
          serverLiveOrdersEnabled={serverLiveOrdersEnabled}
          onClose={() => setManageHolding(null)}
          onChanged={onOrderChanged}
        />
      ) : null}
    </div>
  );
}
