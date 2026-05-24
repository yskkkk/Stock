import { useCallback, useEffect, useState, type RefObject } from "react";
import { logoutAuth } from "../api";
import { FeedbackDockRailButton, type FeedbackCornerHandle } from "./FeedbackCorner";
import { useDesktopDockLayout } from "../hooks/useDesktopDockLayout";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import {
  LIVE_TRADE_DOCK_RAIL_TAB_IDS,
  LIVE_TRADE_RIGHT_PANEL_HOST_ID,
  LiveTradeCardSidePanel,
  defaultLiveTradeSideTabTitles,
  notifyLiveTradeAuthChange,
  useLiveTradeAuth,
  useLiveTradeCardSidePanelOptional,
} from "./LiveTradeAuthAndCredentials";
import { ko } from "../i18n/ko";
import {
  LIVE_TRADE_DOCK_TOGGLE_EVENT,
  dispatchLiveTradeDockOpenForm,
} from "../lib/liveTradeDockEvents";

const OPEN_PREF_KEY = "ystock-live-trade-side-dock-open";

function readDockOpenPref(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const v = localStorage.getItem(OPEN_PREF_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** 접힘=왼쪽, 펼침=오른쪽 — 텍스트 `<` `>` 대신 stroke chevron */
function DockFoldChevron({ open }: { open: boolean }) {
  return (
    <span
      className={
        open
          ? "app-live-trade-side-dock__chevron app-live-trade-side-dock__chevron--open"
          : "app-live-trade-side-dock__chevron"
      }
      aria-hidden
    />
  );
}

function railTabShort(
  id: string,
  title: string,
  loggedIn: boolean,
): { glyph: string; label: string } {
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.auth) {
    return {
      glyph: "◎",
      label: loggedIn ? ko.app.liveTradeDockRailAccount : ko.app.liveTradeSideDockRailAuth,
    };
  }
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb) {
    return { glyph: "B", label: ko.app.leftRailBithumbAccountTitle };
  }
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.liveRail) {
    return { glyph: "실", label: ko.app.liveTradeLeftRailTitle };
  }
  if (id === "portfolio") {
    return { glyph: "₩", label: ko.app.liveTradeSideDockRailPortfolio };
  }
  if (id === "form") {
    return { glyph: "+", label: ko.app.liveTradeSideDockRailForm };
  }
  if (id === "programs") {
    return { glyph: "≡", label: ko.app.liveTradeSideDockRailPrograms };
  }
  const label = title.length > 5 ? `${title.slice(0, 4)}…` : title;
  return { glyph: label.slice(0, 1), label };
}

/** 운영 제외 전 탭 — 토스형 우측 레일 + 슬라이드 패널(레이아웃 비점유) */
export default function AppLiveTradeSideDock({
  feedbackRef,
  feedbackActive = false,
}: {
  feedbackRef?: RefObject<FeedbackCornerHandle | null>;
  feedbackActive?: boolean;
}) {
  const { user, authChecked } = useLiveTradeAuth();
  const ctx = useLiveTradeCardSidePanelOptional();
  const closePanel = ctx?.closePanel;
  const allSideTabs =
    (ctx?.sideTabs?.length ?? 0) > 0
      ? ctx!.sideTabs
      : Object.entries(defaultLiveTradeSideTabTitles()).map(([id, title]) => ({
          id,
          title,
        }));
  const sideTabs = user
    ? allSideTabs
    : allSideTabs.filter((t) => t.id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.auth);
  const panel = ctx?.panel ?? null;
  const openPanel = ctx?.openPanel;
  const wide = useDesktopDockLayout();
  const [open, setOpen] = useState(readDockOpenPref);

  useEffect(() => {
    if (panel?.id) setOpen(true);
  }, [panel?.id]);

  const persistOpen = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_PREF_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFold = useCallback(() => {
    persistOpen(!open);
  }, [open, persistOpen]);

  useEffect(() => {
    const onToggle = () => toggleFold();
    window.addEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
  }, [toggleFold]);

  const activeId = panel?.id ?? null;

  const onRailTab = useCallback(
    (id: string, title: string) => {
      if (!openPanel) return;
      if (id === "form" && activeId !== "form") {
        dispatchLiveTradeDockOpenForm();
      }
      openPanel(id, title);
      persistOpen(true);
    },
    [openPanel, persistOpen, activeId],
  );

  const handleLogout = useCallback(() => {
    void logoutAuth().then(() => {
      invalidateLiveTradingPrefetch();
      refreshLiveTradingStatusNow();
      notifyLiveTradeAuthChange();
      closePanel?.();
      persistOpen(false);
    });
  }, [closePanel, persistOpen]);

  if (!wide || !authChecked || sideTabs.length === 0) return null;

  return (
    <div
      className={`app-live-trade-side-dock${
        open ? " app-live-trade-side-dock--open" : " app-live-trade-side-dock--collapsed"
      }`}
      data-live-trade-side-dock
    >
      <div
        id="app-live-trade-side-dock-panel"
        className="app-live-trade-side-dock__panel"
        aria-hidden={!open}
      >
        <button
          type="button"
          className="app-live-trade-side-dock__panel-edge"
          onClick={toggleFold}
          aria-expanded={open}
          aria-controls="app-live-trade-side-dock-panel"
          title={open ? ko.app.liveTradeSideDockCollapse : ko.app.liveTradeSideDockExpand}
        >
          <DockFoldChevron open={open} />
        </button>
        <div
          id={LIVE_TRADE_RIGHT_PANEL_HOST_ID}
          className="app-live-trade-side-dock__host"
        >
          <LiveTradeCardSidePanel forceDocked railMode />
        </div>
      </div>
      <nav
        className="app-live-trade-side-dock__rail"
        aria-label={ko.app.liveTradeSideDockRailAria}
      >
        <button
          type="button"
          className="app-live-trade-side-dock__fold"
          onClick={toggleFold}
          aria-expanded={open}
          aria-controls="app-live-trade-side-dock-panel"
          title={open ? ko.app.liveTradeSideDockCollapse : ko.app.liveTradeSideDockExpand}
        >
          <DockFoldChevron open={open} />
        </button>
        <div className="app-live-trade-side-dock__rail-tabs">
        {sideTabs.map((tab) => {
          const selected = open && activeId === tab.id;
          const { glyph, label } = railTabShort(tab.id, tab.title, Boolean(user));
          return (
            <button
              key={tab.id}
              type="button"
              className={
                selected
                  ? "app-live-trade-side-dock__rail-btn app-live-trade-side-dock__rail-btn--on"
                  : "app-live-trade-side-dock__rail-btn"
              }
              aria-selected={selected}
              aria-controls="app-live-trade-side-dock-panel"
              title={tab.title}
              onClick={() => onRailTab(tab.id, tab.title)}
            >
              <span className="app-live-trade-side-dock__rail-glyph" aria-hidden>
                {glyph}
              </span>
              <span className="app-live-trade-side-dock__rail-label">{label}</span>
            </button>
          );
        })}
        </div>
        <div className="app-live-trade-side-dock__rail-footer">
          {user ? (
            <button
              type="button"
              className="app-live-trade-side-dock__rail-btn app-live-trade-side-dock__rail-btn--logout"
              title={ko.app.liveTradeAuthLogout}
              onClick={() => handleLogout()}
            >
              <span className="app-live-trade-side-dock__rail-glyph" aria-hidden>
                ⎋
              </span>
              <span className="app-live-trade-side-dock__rail-label">
                {ko.app.liveTradeAuthLogout}
              </span>
            </button>
          ) : null}
          {feedbackRef ? (
            <FeedbackDockRailButton
              active={feedbackActive}
              onClick={() => feedbackRef.current?.openSubmit()}
            />
          ) : null}
        </div>
      </nav>
    </div>
  );
}
