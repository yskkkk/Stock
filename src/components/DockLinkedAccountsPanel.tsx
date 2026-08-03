import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import {
  TOSS_LEDGER_POLL_MS,
  useTossAccountSnapshot,
} from "../hooks/useTossAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { useLiveTradeAuth } from "./LiveTradeAuthAndCredentials";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import TossAccountSnapshotCard from "./TossAccountSnapshotCard";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { LiveTradeExchangePicker } from "./LiveTradeExchangePicker";
import AccountSnapshotFreshness from "./AccountSnapshotFreshness";
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
import type { TossTestHolding } from "../api";

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

function DockLinkedAccountsPanelInner({
  onOpenHoldingChart,
}: {
  onOpenHoldingChart?: (h: TossTestHolding) => void;
}) {
  const { user, authChecked } = useLiveTradeAuth();
  const status = useLiveTradingStatusPoll();
  const bithumbReady = Boolean(status?.bithumb?.ready);
  const tossReady = Boolean(status?.toss?.ready);

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
    syncing: bithumbSyncing,
    err: bithumbErr,
  } = useBithumbAccountSnapshot({ poll: provider === "bithumb" });

  const {
    snapshot: tossSnapshot,
    feeLabelKo: tossFeeLabelHook,
    tossRoundTripFeeRate: tossRoundTripFeeRateHook,
    tossFeeRatesByMarket: tossFeeRatesByMarketHook,
    updatedAtMs: tossUpdatedAtMs,
    loading: tossLoading,
    syncing: tossSyncing,
    err: tossErr,
  } = useTossAccountSnapshot({
    poll: provider === "toss",
    pollIntervalMs: TOSS_LEDGER_POLL_MS,
  });

  const tossFeeLabel =
    status?.feeRates?.toss?.labelKo?.trim() || tossFeeLabelHook || null;
  const tossRoundTripFeeRate =
    status?.feeRates?.toss?.roundTripFeeRate ?? tossRoundTripFeeRateHook ?? null;
  const tossFeeRatesByMarket = useMemo(() => {
    const fromStatus = status?.feeRates?.toss;
    const fromLedger = tossFeeRatesByMarketHook;
    if (fromStatus) {
      return {
        kr: fromStatus.krRoundTripFeeRate ?? fromStatus.roundTripFeeRate,
        us: fromStatus.usRoundTripFeeRate ?? fromStatus.roundTripFeeRate,
        source: fromStatus.source,
      };
    }
    return fromLedger;
  }, [status?.feeRates?.toss, tossFeeRatesByMarketHook]);

  const statusPending = status == null;
  const panelUpdatedAtMs = provider === "bithumb" ? updatedAtMs : tossUpdatedAtMs;
  const panelSyncing = provider === "bithumb" ? bithumbSyncing : tossSyncing;
  const panelErr = provider === "bithumb" ? bithumbErr : tossErr;
  const hasPanelData =
    provider === "bithumb" ? Boolean(snapshot) : Boolean(tossSnapshot);

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
        snapshot ? (
          <BithumbAccountSnapshotCard
            snapshot={snapshot}
            feeLabelKo={bithumbFeeLabel}
            updatedAtMs={updatedAtMs}
            variant="inline"
          />
        ) : (
          <LiveTradeApiNotConnectedNotice
            exchange="bithumb"
            className="dock-linked-accounts__hint dock-linked-accounts__hint--api"
          />
        )
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
      tossSnapshot ? (
        <TossAccountSnapshotCard
          snapshot={tossSnapshot}
          feeLabelKo={tossFeeLabel}
          tossRoundTripFeeRate={tossRoundTripFeeRate}
          tossFeeRatesByMarket={tossFeeRatesByMarket}
          updatedAtMs={tossUpdatedAtMs}
          variant="inline"
          onOpenHoldingChart={onOpenHoldingChart}
        />
      ) : (
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      )
    ) : !tossReady ? (
      tossSnapshot ? (
        <TossAccountSnapshotCard
          snapshot={tossSnapshot}
          feeLabelKo={tossFeeLabel}
          tossRoundTripFeeRate={tossRoundTripFeeRate}
          tossFeeRatesByMarket={tossFeeRatesByMarket}
          updatedAtMs={tossUpdatedAtMs}
          variant="inline"
          onOpenHoldingChart={onOpenHoldingChart}
        />
      ) : (
        <LiveTradeApiNotConnectedNotice
          exchange="toss"
          className="dock-linked-accounts__hint dock-linked-accounts__hint--api"
        />
      )
    ) : tossLoading && !tossSnapshot ? (
      <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
    ) : !tossSnapshot ? (
      <p className="dock-linked-accounts__hint">
        {tossErr ?? ko.app.leftRailTossAccountNeedKeys}
      </p>
    ) : (
      <TossAccountSnapshotCard
        snapshot={tossSnapshot}
        feeLabelKo={tossFeeLabel}
        tossRoundTripFeeRate={tossRoundTripFeeRate}
        tossFeeRatesByMarket={tossFeeRatesByMarket}
        updatedAtMs={tossUpdatedAtMs}
        variant="inline"
        onOpenHoldingChart={onOpenHoldingChart}
      />
    );

  return (
    <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
      <LiveTradeExchangePicker
        compact
        selected={provider}
        onSelect={selectProvider}
      />
      {user && hasPanelData ? (
        <AccountSnapshotFreshness
          syncing={panelSyncing}
          updatedAtMs={panelUpdatedAtMs}
          err={panelErr}
          hasData={hasPanelData}
          className="dock-linked-accounts__freshness panel-freshness"
          staleHintClassName="dock-linked-accounts__stale-hint panel-freshness__stale-hint"
        />
      ) : null}
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
