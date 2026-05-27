import { memo, useCallback, useEffect, useState } from "react";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import TossAccountBalancePanel from "./TossAccountBalancePanel";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import {
  consumePendingDockAccountView,
  dispatchDockAccountProvider,
  LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT,
  LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT,
  readDockAccountProvider,
  readDockAccountViewEvent,
  type LiveTradeDockAccountView,
} from "../lib/liveTradeDockAccount";
import { navigateToTradeHistoryTab } from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import LiveTradeApiNotConnectedNotice from "./LiveTradeApiNotConnectedNotice";
import { ko } from "../i18n/ko";

type LinkedProvider = LiveTradeTradesExchange;

function applyAccountView(
  view: LiveTradeDockAccountView | undefined,
  selectProvider: (p: LinkedProvider) => void,
) {
  if (!view) return;
  if (view.provider === "bithumb" || view.provider === "toss") {
    selectProvider(view.provider);
  }
  if (view.subTab === "trades") {
    const ex =
      view.provider === "toss" || view.provider === "bithumb"
        ? view.provider
        : readDockAccountProvider();
    navigateToTradeHistoryTab(ex);
  }
}

function DockLinkedAccountsPanelInner() {
  const { user, authChecked } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const bithumbReady = Boolean(status?.bithumb?.ready);
  const tossReady = Boolean(status?.toss?.ready);
  const tossFeeLabel = status?.feeRates?.toss?.labelKo?.trim() || null;

  const [provider, setProvider] = useState<LinkedProvider>(readDockAccountProvider);

  const selectProvider = useCallback((next: LinkedProvider) => {
    setProvider(next);
    dispatchDockAccountProvider(next);
  }, []);

  const applyView = useCallback((view?: LiveTradeDockAccountView) => {
    applyAccountView(view, selectProvider);
  }, [selectProvider]);

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
  } = useBithumbAccountSnapshot({ poll: provider === "bithumb" });

  const statusPending = status == null;

  if (!authChecked) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
        <p className="dock-linked-accounts__empty" role="status">
          {ko.app.liveTradeDockNoLinkedAccounts}
        </p>
      </div>
    );
  }

  const balanceBody =
    provider === "bithumb" ? (
      statusPending ? (
        snapshot ? (
          <BithumbAccountSnapshotCard
            snapshot={snapshot}
            feeLabelKo={bithumbFeeLabel}
            updatedAtMs={updatedAtMs}
            variant="inline"
          />
        ) : (
          <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
        )
      ) : !bithumbReady ? (
        <LiveTradeApiNotConnectedNotice
          exchange="bithumb"
          className="dock-linked-accounts__hint dock-linked-accounts__hint--api"
        />
      ) : bithumbLoading && !snapshot ? (
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
    ) : statusPending ? (
      <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
    ) : !tossReady ? (
      <LiveTradeApiNotConnectedNotice
        exchange="toss"
        className="dock-linked-accounts__hint dock-linked-accounts__hint--api"
      />
    ) : (
      <TossAccountBalancePanel feeLabelKo={tossFeeLabel} />
    );

  return (
    <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
      <LiveTradeExchangePicker
        compact
        selected={provider}
        onSelect={selectProvider}
      />
      <div
        className="dock-linked-accounts__body"
        role="region"
        aria-label={ko.app.liveTradeDockAccountTabBalance}
      >
        {balanceBody}
      </div>
    </div>
  );
}

export default memo(DockLinkedAccountsPanelInner);
