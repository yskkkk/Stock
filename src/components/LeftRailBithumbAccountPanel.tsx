import { memo, useEffect, useState } from "react";
import { fetchAuthMe } from "../api";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import BithumbAccountTitle from "./BithumbAccountTitle";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import { ko } from "../i18n/ko";

export function BithumbAccountRailCore({
  onOpenLiveTrading,
  layout = "rail-aside",
}: {
  onOpenLiveTrading?: () => void;
  layout?: "rail-aside" | "dock";
}) {
  const { user, authChecked, snapshot, feeLabelKo, updatedAtMs, loading, err } =
    useBithumbAccountSnapshot();

  if (!authChecked || !user) return null;

  const head = (
    <div className="bithumb-account-rail-wrap__head">
      <button
        type="button"
        className="bithumb-account-rail-wrap__title-btn"
        onClick={() => onOpenLiveTrading?.()}
        title={layout === "rail-aside" ? ko.app.liveTradeLeftRailOpen : undefined}
      >
        <BithumbAccountTitle />
      </button>
      {loading ? (
        <span className="bithumb-account-rail-wrap__status">
          {ko.app.marketIndicesLoading}
        </span>
      ) : null}
    </div>
  );

  const body =
    !loading && !snapshot ? (
      <p className="bithumb-account-rail-wrap__hint">
        {err ?? ko.app.leftRailBithumbAccountNeedKeys}
      </p>
    ) : !snapshot ? null : (
      <BithumbAccountSnapshotCard
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
      <div className="app-dock-rail-panel app-dock-rail-panel--bithumb">{inner}</div>
    );
  }

  return (
    <aside
      className="bithumb-account-rail-wrap bithumb-account-rail-wrap--side"
      role="complementary"
      aria-label={ko.app.leftRailBithumbAccountAria}
    >
      {inner}
    </aside>
  );
}

function LeftRailBithumbAccountPanelInner({
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
        className="bithumb-account-rail-wrap bithumb-account-rail-wrap--side"
        aria-hidden
      >
        <div className="bithumb-account-rail-wrap__sk" />
      </aside>
    );
  }

  return (
    <BithumbAccountRailCore onOpenLiveTrading={onOpenLiveTrading} layout="rail-aside" />
  );
}

export default memo(LeftRailBithumbAccountPanelInner);
