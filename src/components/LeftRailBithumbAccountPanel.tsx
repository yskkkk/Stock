import { memo, useCallback, useEffect, useState } from "react";
import {
  fetchAuthMe,
  fetchBithumbAccountSnapshot,
  type AuthUser,
  type BithumbTestSnapshot,
} from "../api";
import BithumbAccountSnapshotCard from "./BithumbAccountSnapshotCard";
import { ko } from "../i18n/ko";
import { LIVE_TRADE_AUTH_CHANGE } from "./LiveTradeAuthAndCredentials";

const POLL_MS = 45_000;

function LeftRailBithumbAccountPanelInner({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<BithumbTestSnapshot | null>(null);
  const [feeLabelKo, setFeeLabelKo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await fetchAuthMe();
      setUser(me.user);
      if (!me.user) {
        setSnapshot(null);
        setFeeLabelKo(null);
        setErr(null);
        return;
      }
      const out = await fetchBithumbAccountSnapshot();
      if (out.ready && out.snapshot) {
        setSnapshot(out.snapshot);
        setFeeLabelKo(out.feeLabelKo ?? null);
        setErr(null);
      } else {
        setSnapshot(null);
        setFeeLabelKo(null);
        setErr(out.messageKo ?? null);
      }
    } catch (e) {
      setSnapshot(null);
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

  if (!user) return null;

  if (!loading && !snapshot) {
    return (
      <aside
        className="bithumb-account-rail-wrap bithumb-account-rail-wrap--side"
        role="complementary"
        aria-label={ko.app.leftRailBithumbAccountAria}
      >
        <div className="bithumb-account-rail-wrap__head">
          <button
            type="button"
            className="bithumb-account-rail-wrap__title-btn"
            onClick={() => onOpenLiveTrading?.()}
          >
            <span className="bithumb-account-rail-wrap__title">
              {ko.app.leftRailBithumbAccountTitle}
            </span>
          </button>
        </div>
        <p className="bithumb-account-rail-wrap__hint">
          {err ?? ko.app.leftRailBithumbAccountNeedKeys}
        </p>
      </aside>
    );
  }

  if (!snapshot) return null;

  return (
    <aside
      className="bithumb-account-rail-wrap bithumb-account-rail-wrap--side"
      role="complementary"
      aria-label={ko.app.leftRailBithumbAccountAria}
    >
      <div className="bithumb-account-rail-wrap__head">
        <button
          type="button"
          className="bithumb-account-rail-wrap__title-btn"
          onClick={() => onOpenLiveTrading?.()}
          title={ko.app.liveTradeLeftRailOpen}
        >
          <span className="bithumb-account-rail-wrap__title">
            {ko.app.leftRailBithumbAccountTitle}
          </span>
        </button>
        {loading ? (
          <span className="bithumb-account-rail-wrap__status">
            {ko.app.marketIndicesLoading}
          </span>
        ) : null}
      </div>
      <BithumbAccountSnapshotCard
        snapshot={snapshot}
        feeLabelKo={feeLabelKo}
        variant="rail"
      />
    </aside>
  );
}

export default memo(LeftRailBithumbAccountPanelInner);
