import { useCallback, useEffect, type ReactNode } from "react";
import { useDesktopDockLayout } from "../hooks/useDesktopDockLayout";
import { logoutAuth } from "../api";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import {
  refreshLiveTradingStatusNow,
  useLiveTradingStatusPoll,
} from "../hooks/useLiveTradingStatusPoll";
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
    <LiveTradeSidePanelPortal active={active} hostRef={ctx.bodyHostRef}>
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
  const liveStatus = useLiveTradingStatusPoll();

  useEffect(() => {
    if (!ctx || !authChecked) return;
    const ids = LIVE_TRADE_DOCK_RAIL_TAB_IDS;
    if (!user) {
      return ctx.registerSideTab(ids.auth, ko.app.liveTradeSideDockRailAuth);
    }
    const cleanups = [
      ctx.registerSideTab(ids.auth, ko.app.liveTradeSideDockRailAuth),
      ctx.registerSideTab(ids.bithumb, ko.app.leftRailBithumbAccountTitle),
      ctx.registerSideTab(ids.liveRail, ko.app.liveTradeLeftRailTitle),
    ];
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [ctx, user, authChecked]);

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
              <ul
                className="app-dock-rail-panel__api-status"
                aria-label={ko.app.liveTradeApiRowAria}
              >
                <li>
                  <span>{ko.app.liveTradeTossTitle}</span>
                  <span>
                    {liveStatus?.toss?.ready
                      ? ko.app.liveTradeTossOk
                      : liveStatus?.toss?.configured
                        ? ko.app.liveTradeApiStatusPartial
                        : ko.app.liveTradeTossNo}
                  </span>
                </li>
                <li>
                  <span>{ko.app.liveTradeBithumbTitle}</span>
                  <span>
                    {liveStatus?.bithumb?.ready
                      ? ko.app.liveTradeTossOk
                      : liveStatus?.bithumb?.configured
                        ? ko.app.liveTradeApiStatusPartial
                        : ko.app.liveTradeTossNo}
                  </span>
                </li>
              </ul>
              {onOpenLiveTrading ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm app-dock-rail-panel__cta"
                  onClick={onOpenLiveTrading}
                >
                  {ko.app.liveTradeSideDockOpenApi}
                </button>
              ) : null}
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
