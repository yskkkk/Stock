import { memo, useEffect, useState } from "react";
import { fetchAuthMe } from "../api";
import TossAccountSnapshotCard from "./TossAccountSnapshotCard";
import TossAccountTitle from "./TossAccountTitle";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { useTossAccountSnapshot } from "../hooks/useTossAccountSnapshot";
import { ko } from "../i18n/ko";

export function TossAccountRailCore({
  onOpenLiveTrading,
  layout = "rail-aside",
}: {
  onOpenLiveTrading?: () => void;
  layout?: "rail-aside" | "dock";
}) {
  const { user, authChecked, snapshot, feeLabelKo, updatedAtMs, loading, err } =
    useTossAccountSnapshot();

  if (authChecked && !user) return null;

  const pending = !authChecked || loading;

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
      updatedAtMs={updatedAtMs}
      variant={layout === "dock" ? "inline" : "rail"}
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
