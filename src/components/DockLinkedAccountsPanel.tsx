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
import {
  dispatchLiveTradeTradesWorkspace,
} from "../lib/liveTradeTradesWorkspace";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";
import { ko } from "../i18n/ko";

type LinkedProvider = LiveTradeTradesExchange;

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
    dispatchLiveTradeTradesWorkspace({ mode: "history", exchange: ex });
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
    dispatchLiveTradeTradesWorkspace(null);
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

  const providerReady = provider === "bithumb" ? bithumbReady : tossReady;

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

  const balanceBody =
    provider === "bithumb" ? (
      !bithumbReady ? (
        <ApiNotConnectedMessage exchange="bithumb" />
      ) : bithumbLoading ? (
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
