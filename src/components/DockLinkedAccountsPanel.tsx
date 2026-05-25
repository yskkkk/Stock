import { memo, useEffect, useState } from "react";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import TossAccountBalancePanel from "./TossAccountBalancePanel";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { ko } from "../i18n/ko";

type LinkedProvider = "bithumb" | "toss";
type AccountSubTab = "balance" | "trades";

function DockLinkedAccountsPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const status = useLiveTradingStatusPoll();
  const bithumbLinked = Boolean(status?.bithumb?.ready);
  const tossLinked = Boolean(status?.toss?.ready);
  const tossFeeLabel = status?.feeRates?.toss?.labelKo?.trim() || null;

  const [provider, setProvider] = useState<LinkedProvider>("bithumb");
  const [subTab, setSubTab] = useState<AccountSubTab>("balance");

  useEffect(() => {
    if (provider === "bithumb" && !bithumbLinked && tossLinked) {
      setProvider("toss");
    } else if (provider === "toss" && !tossLinked && bithumbLinked) {
      setProvider("bithumb");
    }
  }, [bithumbLinked, tossLinked, provider]);

  const {
    authChecked,
    user,
    snapshot,
    feeLabelKo: bithumbFeeLabel,
    updatedAtMs,
    loading: bithumbLoading,
    err: bithumbErr,
  } = useBithumbAccountSnapshot();

  if (!bithumbLinked && !tossLinked) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts">
        <p className="dock-linked-accounts__empty" role="status">
          {ko.app.liveTradeDockNoLinkedAccounts}
        </p>
      </div>
    );
  }

  const showExchangePicker = bithumbLinked && tossLinked;
  const pending =
    provider === "bithumb" &&
    (!authChecked || bithumbLoading || (authChecked && !user));
  const canShowSubTabs =
    (provider === "bithumb" && Boolean(user) && !pending) ||
    (provider === "toss" && tossLinked);

  return (
    <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
      {showExchangePicker ? (
        <div
          className="dock-linked-accounts__exchange-row"
          role="tablist"
          aria-label={ko.app.liveTradeDockAccountExchangeAria}
        >
          {bithumbLinked ? (
            <button
              type="button"
              role="tab"
              className={
                provider === "bithumb"
                  ? "dock-linked-accounts__exchange-btn dock-linked-accounts__exchange-btn--on"
                  : "dock-linked-accounts__exchange-btn"
              }
              aria-selected={provider === "bithumb"}
              onClick={() => {
                setProvider("bithumb");
                setSubTab("balance");
              }}
            >
              <BithumbBrandMark className="dock-linked-accounts__exchange-mark" />
              <span>{ko.app.liveTradeBithumbShort}</span>
            </button>
          ) : null}
          {tossLinked ? (
            <button
              type="button"
              role="tab"
              className={
                provider === "toss"
                  ? "dock-linked-accounts__exchange-btn dock-linked-accounts__exchange-btn--on"
                  : "dock-linked-accounts__exchange-btn"
              }
              aria-selected={provider === "toss"}
              onClick={() => {
                setProvider("toss");
                setSubTab("balance");
              }}
            >
              <TossBrandMark className="dock-linked-accounts__exchange-mark" />
              <span>{ko.app.liveTradeTossShort}</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div className="dock-linked-accounts__head dock-linked-accounts__head--solo">
          {provider === "bithumb" ? (
            <button
              type="button"
              className="dock-linked-accounts__solo-title"
              onClick={() => onOpenLiveTrading?.()}
              title={onOpenLiveTrading ? ko.app.liveTradeLeftRailOpen : undefined}
            >
              <BithumbBrandMark className="dock-linked-accounts__mark" />
              <span>{ko.app.leftRailBithumbAccountTitle}</span>
            </button>
          ) : (
            <span className="dock-linked-accounts__title dock-linked-accounts__title--brand">
              <TossBrandMark className="dock-linked-accounts__mark" />
              <span className="dock-linked-accounts__title-copy">
                <span className="dock-linked-accounts__title-text">토스</span>
                <span className="dock-linked-accounts__title-suffix">계좌</span>
              </span>
            </span>
          )}
        </div>
      )}

      {canShowSubTabs ? (
        <div
          className="dock-linked-accounts__subtabs"
          role="tablist"
          aria-label={ko.app.liveTradeDockAccountSubTabsAria}
        >
          <button
            type="button"
            role="tab"
            className={
              subTab === "balance"
                ? "dock-linked-accounts__subtab dock-linked-accounts__subtab--on"
                : "dock-linked-accounts__subtab"
            }
            aria-selected={subTab === "balance"}
            onClick={() => setSubTab("balance")}
          >
            {ko.app.liveTradeDockAccountTabBalance}
          </button>
          <button
            type="button"
            role="tab"
            className={
              subTab === "trades"
                ? "dock-linked-accounts__subtab dock-linked-accounts__subtab--on"
                : "dock-linked-accounts__subtab"
            }
            aria-selected={subTab === "trades"}
            onClick={() => setSubTab("trades")}
          >
            {ko.app.liveTradeDockAccountTabTrades}
          </button>
        </div>
      ) : null}

      <div
        className="dock-linked-accounts__body"
        role="tabpanel"
        aria-label={
          subTab === "trades"
            ? ko.app.liveTradeDockAccountTabTrades
            : ko.app.liveTradeDockAccountTabBalance
        }
      >
        {provider === "bithumb" ? (
          pending ? (
            <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
          ) : subTab === "trades" ? (
            <LiveTradeTradesHistoryPanel embedded exchange="bithumb" />
          ) : !snapshot ? (
            <p className="dock-linked-accounts__hint">
              {bithumbErr ?? ko.app.leftRailBithumbAccountNeedKeys}
            </p>
          ) : (
            <BithumbAccountSnapshotCard
              snapshot={snapshot}
              feeLabelKo={bithumbFeeLabel}
              updatedAtMs={updatedAtMs}
              variant="inline"
            />
          )
        ) : subTab === "trades" ? (
          <LiveTradeTradesHistoryPanel embedded exchange="toss" />
        ) : (
          <TossAccountBalancePanel feeLabelKo={tossFeeLabel} />
        )}
      </div>
    </div>
  );
}

export default memo(DockLinkedAccountsPanelInner);
