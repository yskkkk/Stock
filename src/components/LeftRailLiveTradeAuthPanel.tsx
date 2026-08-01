import { memo, useCallback } from "react";
import { logoutLiveTradeAndClearCaches } from "../lib/clearLiveTradeClientCachesOnLogout";
import {
  LiveTradeAuthSignedInCard,
  useLiveTradeAuth,
} from "./LiveTradeAuthAndCredentials";
import { ko } from "../i18n/ko";

function LeftRailLiveTradeAuthPanelInner() {
  const { user, authChecked } = useLiveTradeAuth();

  const onLogout = useCallback(() => {
    void logoutLiveTradeAndClearCaches();
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
        onLogout={onLogout}
      />
    </aside>
  );
}

export default memo(LeftRailLiveTradeAuthPanelInner);
