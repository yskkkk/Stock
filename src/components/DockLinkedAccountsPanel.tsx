import { memo, useCallback, useEffect, useState } from "react";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import TossAccountBalancePanel from "./TossAccountBalancePanel";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import LiveTradeTradesHistoryPanel from "./LiveTradeTradesHistoryPanel";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import {
  consumePendingDockAccountView,
  LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT,
  LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT,
  readDockAccountViewEvent,
  type LiveTradeDockAccountView,
} from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { ko } from "../i18n/ko";

type LinkedProvider = LiveTradeTradesExchange;
type AccountSubTab = "balance" | "trades";

function ApiNotConnectedMessage({ exchange }: { exchange: LinkedProvider }) {
  const label =
    exchange === "bithumb"
      ? ko.app.liveTradeBithumbShort
      : ko.app.liveTradeTossShort;
  return (
    <p className="dock-linked-accounts__hint dock-linked-accounts__hint--api" role="status">
      {label} {ko.app.liveTradeApiNotConnected}
    </p>
  );
}

function applyAccountView(
  view: LiveTradeDockAccountView | undefined,
  setters: {
    setProvider: (p: LinkedProvider) => void;
    setSubTab: (t: AccountSubTab) => void;
    setTradesExchange: (e: LiveTradeTradesExchange | null) => void;
  },
) {
  if (!view) return;
  if (view.provider === "bithumb" || view.provider === "toss") {
    setters.setProvider(view.provider);
  }
  if (view.subTab === "balance" || view.subTab === "trades") {
    setters.setSubTab(view.subTab);
  }
  if (view.subTab === "trades") {
    setters.setTradesExchange(
      view.tradesExchange === "bithumb" || view.tradesExchange === "toss"
        ? view.tradesExchange
        : null,
    );
  }
}

function DockLinkedAccountsPanelInner() {
  const { user, authChecked } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const bithumbReady = Boolean(status?.bithumb?.ready);
  const tossReady = Boolean(status?.toss?.ready);
  const tossFeeLabel = status?.feeRates?.toss?.labelKo?.trim() || null;

  const [provider, setProvider] = useState<LinkedProvider>("bithumb");
  const [subTab, setSubTab] = useState<AccountSubTab>("balance");
  const [tradesExchange, setTradesExchange] = useState<LiveTradeTradesExchange | null>(
    null,
  );

  const applyView = useCallback((view?: LiveTradeDockAccountView) => {
    applyAccountView(view, { setProvider, setSubTab, setTradesExchange });
  }, []);

  useEffect(() => {
    const pending = consumePendingDockAccountView();
    if (pending) applyView(pending);
  }, [applyView]);

  useEffect(() => {
    const onOpen = (e: Event) => applyView(readDockAccountViewEvent(e));
    const onView = (e: Event) => applyView(readDockAccountViewEvent(e));
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT, onOpen);
    window.addEventListener(LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT, onView);
    return () => {
      window.removeEventListener(LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT, onOpen);
      window.removeEventListener(LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT, onView);
    };
  }, [applyView]);

  const {
    snapshot,
    feeLabelKo: bithumbFeeLabel,
    updatedAtMs,
    loading: bithumbLoading,
    err: bithumbErr,
  } = useBithumbAccountSnapshot();

  if (!authChecked) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts">
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts">
        <p className="dock-linked-accounts__empty" role="status">
          {ko.app.liveTradeDockNoLinkedAccounts}
        </p>
      </div>
    );
  }

  const providerReady = provider === "bithumb" ? bithumbReady : tossReady;
  const bithumbPending = bithumbLoading;

  const balanceBody =
    provider === "bithumb" ? (
      !bithumbReady ? (
        <ApiNotConnectedMessage exchange="bithumb" />
      ) : bithumbPending ? (
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
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
    ) : !tossReady ? (
      <ApiNotConnectedMessage exchange="toss" />
    ) : (
      <TossAccountBalancePanel feeLabelKo={tossFeeLabel} />
    );

  const tradesBody = !providerReady ? (
    <ApiNotConnectedMessage exchange={provider} />
  ) : tradesExchange == null ? (
    <LiveTradeExchangePicker
      compact
      onSelect={(ex) => {
        setTradesExchange(ex);
        setProvider(ex);
      }}
    />
  ) : (
    <>
      <button
        type="button"
        className="live-trade-trades-workspace__back dock-linked-accounts__trades-back"
        onClick={() => setTradesExchange(null)}
      >
        {ko.app.liveTradeTradesWorkspaceBack}
      </button>
      <LiveTradeTradesHistoryPanel embedded exchange={tradesExchange} />
    </>
  );

  return (
    <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
      <div
        className="dock-linked-accounts__exchange-row"
        role="tablist"
        aria-label={ko.app.liveTradeDockAccountExchangeAria}
      >
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
            setTradesExchange(null);
          }}
        >
          <BithumbBrandMark className="dock-linked-accounts__exchange-mark" />
          <span>{ko.app.liveTradeBithumbShort}</span>
        </button>
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
            setTradesExchange(null);
          }}
        >
          <TossBrandMark className="dock-linked-accounts__exchange-mark" />
          <span>{ko.app.liveTradeTossShort}</span>
        </button>
      </div>

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
          onClick={() => {
            setSubTab("balance");
            setTradesExchange(null);
          }}
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
          onClick={() => {
            setSubTab("trades");
            setTradesExchange(null);
          }}
        >
          {ko.app.liveTradeDockAccountTabTrades}
        </button>
      </div>

      <div
        className="dock-linked-accounts__body"
        role="tabpanel"
        aria-label={
          subTab === "trades"
            ? ko.app.liveTradeDockAccountTabTrades
            : ko.app.liveTradeDockAccountTabBalance
        }
      >
        {subTab === "balance" ? balanceBody : tradesBody}
      </div>
    </div>
  );
}

export default memo(DockLinkedAccountsPanelInner);
