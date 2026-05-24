import { memo, useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchBithumbAccountSnapshot,
  type AuthUser,
  type BithumbTestSnapshot,
} from "../api";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import BithumbAccountTitle from "./BithumbAccountTitle";
import { ko } from "../i18n/ko";
import { LIVE_TRADE_AUTH_CHANGE } from "./LiveTradeAuthAndCredentials";

const POLL_MS = 45_000;

export function BithumbAccountRailCore({
  onOpenLiveTrading,
  layout = "rail-aside",
}: {
  onOpenLiveTrading?: () => void;
  layout?: "rail-aside" | "dock";
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await fetchAuthMe();
      setUser(me.user);
      if (!me.user) {
        setSnapshot(null);
        setFeeLabelKo(null);
        setUpdatedAtMs(null);
        setErr(null);
        return;
      }
      const out = await fetchBithumbAccountSnapshot();
      if (out.ready && out.snapshot) {
        setSnapshot(out.snapshot);
        setFeeLabelKo(out.feeLabelKo ?? null);
        setUpdatedAtMs(Date.now());
        setErr(null);
      } else {
        setSnapshot(null);
        setFeeLabelKo(null);
        setUpdatedAtMs(null);
        setErr(out.messageKo ?? null);
      }
    } catch (e) {
      setSnapshot(null);
      setUpdatedAtMs(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), POLL_MS);
    const onAuthChange = () => {
      void reload();
    };
    window.addEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(LIVE_TRADE_AUTH_CHANGE, onAuthChange);
    };
  }, [reload]);

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
