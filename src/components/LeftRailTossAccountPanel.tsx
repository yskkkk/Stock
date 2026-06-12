import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAuthMe, fetchLiveTradingStatus, fetchUserCredentials } from "../api";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import { mergeTossFeeRates, tossFeeRatesFromStatus } from "../lib/tossHoldingFeeRates";
import TossAccountSnapshotCard from "./TossAccountSnapshotCard";
import TossAccountTitle from "./TossAccountTitle";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import {
  TOSS_LEDGER_POLL_MS,
  useTossAccountSnapshot,
} from "../hooks/useTossAccountSnapshot";
import { ko } from "../i18n/ko";

export function TossAccountRailCore({
  onOpenLiveTrading,
  layout = "rail-aside",
}: {
  onOpenLiveTrading?: () => void;
  layout?: "rail-aside" | "dock";
}) {
  const {
    user,
    authChecked,
    snapshot,
    feeLabelKo,
    tossRoundTripFeeRate,
    tossFeeRatesByMarket,
    updatedAtMs,
    loading,
    err,
    reload,
  } = useTossAccountSnapshot({ poll: true, pollIntervalMs: TOSS_LEDGER_POLL_MS });
  const status = useLiveTradingStatusPoll();
  const mergedFeeRates = useMemo(
    () =>
      mergeTossFeeRates(
        tossFeeRatesByMarket,
        tossFeeRatesFromStatus(status?.feeRates?.toss),
      ),
    [tossFeeRatesByMarket, status?.feeRates?.toss],
  );
  const [liveOrdersEnabled, setLiveOrdersEnabled] = useState(false);
  const [serverLiveOrdersEnabled, setServerLiveOrdersEnabled] = useState(false);

  const reloadOrderMeta = useCallback(async () => {
    try {
      const creds = await fetchUserCredentials();
      setLiveOrdersEnabled(Boolean(creds.toss?.liveOrdersEnabled));
    } catch {
      setLiveOrdersEnabled(false);
    }
    try {
      const status = await fetchLiveTradingStatus();
      setServerLiveOrdersEnabled(status.tossSimulatedOrders === false);
    } catch {
      setServerLiveOrdersEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLiveOrdersEnabled(false);
      setServerLiveOrdersEnabled(false);
      return;
    }
    void reloadOrderMeta();
  }, [user, reloadOrderMeta]);

  const hadSnapshotRef = useRef(Boolean(snapshot));
  if (snapshot) hadSnapshotRef.current = true;

  if (authChecked && !user) return null;

  const pending =
    !authChecked || (loading && !snapshot && !hadSnapshotRef.current);

  const head = (
    <div className="bithumb-account-rail-wrap__head">
      <button
        type="button"
        className="bithumb-account-rail-wrap__title-btn"
        onClick={() => onOpenLiveTrading?.()}
        title={layout === "rail-aside" ? ko.app.liveTradeLeftRailOpen : undefined}
      >
        <TossAccountTitle />
      </button>
    </div>
  );

  const body = pending ? (
    <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
  ) : !snapshot ? (
    <p className="bithumb-account-rail-wrap__hint">
      {err ?? ko.app.leftRailTossAccountNeedKeys}
    </p>
  ) : (
    <TossAccountSnapshotCard
      snapshot={snapshot}
      feeLabelKo={feeLabelKo}
      tossRoundTripFeeRate={tossRoundTripFeeRate}
      tossFeeRatesByMarket={mergedFeeRates}
      updatedAtMs={updatedAtMs}
      variant={layout === "dock" ? "inline" : "rail"}
      liveOrdersEnabled={liveOrdersEnabled}
      serverLiveOrdersEnabled={serverLiveOrdersEnabled}
      onOrderChanged={() => {
        void reload(true, true);
        void reloadOrderMeta();
      }}
    />
  );

  const inner = (
    <>
      {head}
      {body}
    </>
  );

  if (layout === "dock") {
    return (
      <div
        className={`app-dock-rail-panel app-dock-rail-panel--toss${
          pending ? " app-dock-rail-panel--pending" : ""
        }`}
      >
        {inner}
      </div>
    );
  }

  return (
    <aside
      className={`bithumb-account-rail-wrap bithumb-account-rail-wrap--side toss-account-rail-wrap${
        pending ? " bithumb-account-rail-wrap--pending" : ""
      }`}
      role="complementary"
      aria-label={ko.app.leftRailTossAccountAria}
    >
      {inner}
    </aside>
  );
}

function LeftRailTossAccountPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    void fetchAuthMe()
      .then(() => setAuthChecked(true))
      .catch(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return (
      <aside
        className="bithumb-account-rail-wrap bithumb-account-rail-wrap--side toss-account-rail-wrap"
        aria-hidden
      >
        <div className="bithumb-account-rail-wrap__sk" />
      </aside>
    );
  }

  return (
    <TossAccountRailCore onOpenLiveTrading={onOpenLiveTrading} layout="rail-aside" />
  );
}

export default memo(LeftRailTossAccountPanelInner);
