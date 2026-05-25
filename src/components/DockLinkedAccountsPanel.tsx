import { memo } from "react";
import type { TossTradingStatus } from "../api";
import { useBithumbAccountSnapshot } from "../hooks/useBithumbAccountSnapshot";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import BithumbAccountTitle from "./BithumbAccountTitle";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import { TossBrandMark } from "./ExchangeBrandMarks";
import { ko } from "../i18n/ko";

function BithumbLinkedAccountSection({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const { authChecked, user, snapshot, feeLabelKo, updatedAtMs, loading, err } =
    useBithumbAccountSnapshot();

  if (authChecked && !user) return null;

  const pending = !authChecked || loading;

  return (
    <section
      className={`dock-linked-accounts__block dock-linked-accounts__block--bithumb${
        pending ? " dock-linked-accounts__block--pending" : ""
      }`}
      aria-label={ko.app.leftRailBithumbAccountAria}
    >
      <div className="dock-linked-accounts__head bithumb-account-rail-wrap__head">
        <button
          type="button"
          className="bithumb-account-rail-wrap__title-btn"
          onClick={() => onOpenLiveTrading?.()}
          title={onOpenLiveTrading ? ko.app.liveTradeLeftRailOpen : undefined}
        >
          <BithumbAccountTitle />
        </button>
      </div>
      {pending ? (
        <DockPanelCenterLoading label={ko.app.marketIndicesLoading} />
      ) : !snapshot ? (
        <p className="dock-linked-accounts__hint">
          {err ?? ko.app.leftRailBithumbAccountNeedKeys}
        </p>
      ) : (
        <BithumbAccountSnapshotCard
          snapshot={snapshot}
          feeLabelKo={feeLabelKo}
          updatedAtMs={updatedAtMs}
          variant="inline"
        />
      )}
    </section>
  );
}

function TossLinkedAccountSection({
  toss,
  feeLabelKo,
}: {
  toss: TossTradingStatus;
  feeLabelKo?: string | null;
}) {
  return (
    <section
      className="dock-linked-accounts__block dock-linked-accounts__block--toss"
      aria-label={ko.app.liveTradeTossAccountSectionAria}
    >
      <div className="dock-linked-accounts__head">
        <span className="dock-linked-accounts__title dock-linked-accounts__title--brand">
          <TossBrandMark className="dock-linked-accounts__mark" />
          <span className="dock-linked-accounts__title-copy">
            <span className="dock-linked-accounts__title-text">토스</span>
            <span className="dock-linked-accounts__title-suffix">계좌</span>
          </span>
        </span>
      </div>
      <p className="dock-linked-accounts__summary">{toss.messageKo}</p>
      {feeLabelKo ? (
        <p className="dock-linked-accounts__fee">
          {ko.app.liveTradeFeeLabel}: {feeLabelKo}
        </p>
      ) : null}
    </section>
  );
}

function DockLinkedAccountsPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const status = useLiveTradingStatusPoll();
  const bithumbLinked = Boolean(status?.bithumb?.ready);
  const tossLinked = Boolean(status?.toss?.ready);
  const tossFeeLabel = status?.feeRates?.toss?.labelKo?.trim() || null;

  if (!bithumbLinked && !tossLinked) {
    return (
      <div className="app-dock-rail-panel app-dock-rail-panel--accounts">
        <p className="dock-linked-accounts__empty" role="status">
          {ko.app.liveTradeDockNoLinkedAccounts}
        </p>
      </div>
    );
  }

  return (
    <div className="app-dock-rail-panel app-dock-rail-panel--accounts dock-linked-accounts">
      {bithumbLinked ? (
        <BithumbLinkedAccountSection onOpenLiveTrading={onOpenLiveTrading} />
      ) : null}
      {tossLinked ? (
        <TossLinkedAccountSection
          toss={status!.toss}
          feeLabelKo={tossFeeLabel}
        />
      ) : null}
    </div>
  );
}

export default memo(DockLinkedAccountsPanelInner);
