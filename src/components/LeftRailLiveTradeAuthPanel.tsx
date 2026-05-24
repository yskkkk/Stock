import { memo, useCallback } from "react";
import { logoutAuth } from "../api";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import {
  LiveTradeAuthSignedInCard,
  notifyLiveTradeAuthChange,
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import { ko } from "../i18n/ko";

function LeftRailLiveTradeAuthPanelInner() {
  const { user, authChecked } = useLiveTradeAuth();

  const onAuthChange = useCallback(() => {
    invalidateLiveTradingPrefetch();
    refreshLiveTradingStatusNow();
    notifyLiveTradeAuthChange();
  }, []);

  if (!authChecked || !user) return null;

  return (
    <aside
      className="left-rail-auth-wrap left-rail-auth-wrap--side"
      role="complementary"
      aria-label={ko.app.liveTradeAuthSignedIn}
    >
      <LiveTradeAuthSignedInCard
        user={user}
        variant="rail"
        onLogout={() => void logoutAuth().then(onAuthChange)}
      />
    </aside>
  );
}

export default memo(LeftRailLiveTradeAuthPanelInner);
