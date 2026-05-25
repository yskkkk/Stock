import { useCallback, useEffect, type ReactNode } from "react";
import { useDesktopDockLayout } from "../hooks/useDesktopDockLayout";
import { logoutAuth } from "../api";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { ko } from "../i18n/ko";
import { BithumbAccountRailCore } from "./LeftRailBithumbAccountPanel";
import { LiveTradingRailCore } from "./LiveTradingLeftRailPanel";
import LiveTradeAuthPanel, {
  LIVE_TRADE_DOCK_RAIL_TAB_IDS,
  LiveTradeAuthSignedInCard,
  LiveTradeSidePanelPortal,
  notifyLiveTradeAuthChange,
  useLiveTradeAuth,
  useLiveTradeCardSidePanelOptional,
} from "./LiveTradeAuthAndCredentials";

function DockRailPanelPortal({
  tabId,
  children,
}: {
  tabId: string;
  children: ReactNode;
}) {
  const ctx = useLiveTradeCardSidePanelOptional();
  const active = ctx?.panel?.id === tabId;
  if (!ctx) return null;
  return (
    <LiveTradeSidePanelPortal active={active} hostEl={ctx.bodyHostEl}>
      {children}
    </LiveTradeSidePanelPortal>
  );
}

/** 로그인·빗썸·실매매 — 우측 도크 패널 본문(포털) */
export default function AppRightDockRailPanels({
  onOpenLiveTrading,
}: {
  onOpenLiveTrading?: () => void;
}) {
  const wide = useDesktopDockLayout();
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const ctx = useLiveTradeCardSidePanelOptional();
  const registerSideTab = ctx?.registerSideTab;

  useEffect(() => {
    if (!registerSideTab || !authChecked) return;
    const ids = LIVE_TRADE_DOCK_RAIL_TAB_IDS;
    if (!user) {
      return;
    }
    const cleanups = [
      registerSideTab(ids.auth, ko.app.liveTradeSideDockRailAuth),
      registerSideTab(ids.bithumb, ko.app.leftRailBithumbAccountTitle),
      registerSideTab(ids.liveRail, ko.app.liveTradeLeftRailTitle),
    ];
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [registerSideTab, user, authChecked]);

  const onAuthChange = useCallback(() => {
    invalidateLiveTradingPrefetch();
    refreshLiveTradingStatusNow();
    notifyLiveTradeAuthChange();
  }, []);

  if (!wide || !authChecked || !ctx) return null;

  const ids = LIVE_TRADE_DOCK_RAIL_TAB_IDS;

  return (
    <>
      <DockRailPanelPortal tabId={ids.auth}>
        <div className="app-dock-rail-panel app-dock-rail-panel--auth">
          {user ? (
            <>
              <LiveTradeAuthSignedInCard
                user={user}
                variant="dock"
                onLogout={() => void logoutAuth().then(onAuthChange)}
              />
            </>
          ) : (
            <LiveTradeAuthPanel
              user={null}
              registrationOpen={registrationOpen}
              onAuthChange={onAuthChange}
            />
          )}
        </div>
      </DockRailPanelPortal>
      {user ? (
        <>
          <DockRailPanelPortal tabId={ids.bithumb}>
            <BithumbAccountRailCore
              onOpenLiveTrading={onOpenLiveTrading}
              layout="dock"
            />
          </DockRailPanelPortal>
          <DockRailPanelPortal tabId={ids.liveRail}>
            <LiveTradingRailCore
              onOpenLiveTrading={onOpenLiveTrading}
              layout="dock"
              showWhenEmpty
            />
          </DockRailPanelPortal>
        </>
      ) : null}
    </>
  );
}
