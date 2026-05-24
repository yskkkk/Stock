import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { logoutAuth } from "../api";
import { FeedbackDockRailButton, type FeedbackCornerHandle } from "./FeedbackCorner";
import { useDesktopDockLayout } from "../hooks/useDesktopDockLayout";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import LiveTradeAuthPanel, {
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
import {
  applyDockPanelWidthCss,
  clampDockPanelWidthPx,
  clearDockPanelWidthCss,
  defaultDockPanelWidthPx,
  persistDockPanelWidthPref,
  readDockPanelWidthPref,
} from "../lib/liveTradeDockPanelWidth";

const OPEN_PREF_KEY = "ystock-live-trade-side-dock-open";

function wheelDeltaY(e: WheelEvent): number {
  let delta = e.deltaY;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
  else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    delta *= window.innerHeight;
  }
  return delta;
}

function isScrollable(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1;
}

function findNestedScrollable(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const oy = getComputedStyle(el).overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      isScrollable(el)
    ) {
      best = el;
    }
  }
  return best;
}

function findDockPanelScrollEl(root: HTMLElement): HTMLElement | null {
  const host = root.querySelector<HTMLElement>(
    ".live-trading-tab__card-tabs-host:not(.live-trading-tab__card-tabs-host--idle)",
  );
  if (host) {
    if (isScrollable(host)) return host;
    const nested = findNestedScrollable(host);
    if (nested) return nested;
  }

  const body = root.querySelector<HTMLElement>(
    ".live-trading-tab__card-tabs-pane--active .live-trading-tab__card-tabs-body",
  );
  if (body && isScrollable(body)) return body;

  return host ?? body;
}

function findMainAppScrollEl(dock: HTMLElement): HTMLElement | null {
  return (
    dock.closest(".app__scroll") ??
    dock.closest(".app")?.querySelector<HTMLElement>(".app__scroll") ??
    null
  );
}

function wheelScrollTargets(dock: HTMLElement, panelOpen: boolean): HTMLElement[] {
  const targets: HTMLElement[] = [];
  if (panelOpen) {
    const panel = findDockPanelScrollEl(dock);
    if (panel) targets.push(panel);
  }
  const main = findMainAppScrollEl(dock);
  if (main && !targets.includes(main)) targets.push(main);
  return targets;
}

/** 패널 → 메인 순, 끝에 닿으면 다음 대상으로 넘김 */
function applyWheelScrollChain(targets: HTMLElement[], e: WheelEvent): boolean {
  const delta = wheelDeltaY(e);
  if (delta === 0) return false;

  for (const el of targets) {
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) continue;

    const top = el.scrollTop;
    if (delta > 0 && top >= max - 0.5) continue;
    if (delta < 0 && top <= 0.5) continue;

    el.scrollTop = Math.max(0, Math.min(max, top + delta));
    return true;
  }
  return false;
}

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

function DockResizeArrows() {
  return (
    <span className="app-live-trade-side-dock__resize-arrows" aria-hidden>
      <svg className="app-live-trade-side-dock__resize-arrow" viewBox="0 0 8 12">
        <path
          d="M6.5 1.5 2.5 6l4 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg className="app-live-trade-side-dock__resize-arrow" viewBox="0 0 8 12">
        <path
          d="M1.5 1.5 5.5 6l-4 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
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
  portalSource = null,
}: {
  feedbackRef?: RefObject<FeedbackCornerHandle | null>;
  feedbackActive?: boolean;
  /** 보유·주문·프로그램 — 도크 본문 포털 소스 */
  portalSource?: ReactNode;
}) {
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
  const authAnchorRef = useRef<HTMLSpanElement>(null);
  const ctx = useLiveTradeCardSidePanelOptional();
  const closePanel = ctx?.closePanel;
  const allSideTabs =
    (ctx?.sideTabs?.length ?? 0) > 0
      ? ctx!.sideTabs
      : Object.entries(defaultLiveTradeSideTabTitles()).map(([id, title]) => ({
          id,
          title,
        }));
  const railTabs = allSideTabs.filter(
    (t) => t.id !== LIVE_TRADE_DOCK_RAIL_TAB_IDS.auth,
  );
  const panel = ctx?.panel ?? null;
  const openPanel = ctx?.openPanel;
  const wide = useDesktopDockLayout();
  const [open, setOpen] = useState(readDockOpenPref);
  const [panelWidthPx, setPanelWidthPx] = useState(() => {
    const saved = readDockPanelWidthPref();
    return saved ?? defaultDockPanelWidthPx();
  });
  const [resizing, setResizing] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const resizeDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const panelWidthBounds = useMemo(
    () => ({
      min: clampDockPanelWidthPx(0),
      max: clampDockPanelWidthPx(99999),
    }),
    [],
  );

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
      setAuthPopoverOpen(false);
      closePanel?.();
      persistOpen(false);
    });
  }, [closePanel, persistOpen]);

  const onDockAuthChange = useCallback(() => {
    invalidateLiveTradingPrefetch();
    refreshLiveTradingStatusNow();
    notifyLiveTradeAuthChange();
    setAuthPopoverOpen(false);
  }, []);

  useEffect(() => {
    if (!authPopoverOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (authAnchorRef.current?.contains(e.target as Node)) return;
      setAuthPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAuthPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [authPopoverOpen]);

  useEffect(() => {
    if (user) setAuthPopoverOpen(false);
  }, [user]);

  useEffect(() => {
    applyDockPanelWidthCss(panelWidthPx);
    return () => clearDockPanelWidthCss();
  }, [panelWidthPx]);

  useEffect(() => {
    const onResize = () => {
      setPanelWidthPx((w) => clampDockPanelWidthPx(w));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onResizePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDragRef.current = { startX: e.clientX, startW: panelWidthPx };
      setResizing(true);
    },
    [open, panelWidthPx],
  );

  const onResizePointerMove = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const next = clampDockPanelWidthPx(drag.startW + (drag.startX - e.clientX));
    setPanelWidthPx(next);
  }, []);

  const finishResize = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    setResizing(false);
    setPanelWidthPx((w) => {
      const clamped = clampDockPanelWidthPx(w);
      persistDockPanelWidthPref(clamped);
      return clamped;
    });
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const onWheel = (e: WheelEvent) => {
      if (!dock.contains(e.target as Node)) return;

      const targets = wheelScrollTargets(dock, openRef.current);
      if (targets.length === 0) return;

      if (applyWheelScrollChain(targets, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    dock.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => dock.removeEventListener("wheel", onWheel, { capture: true });
  }, [wide, authChecked]);

  if (!wide || !authChecked) return null;

  const authRailSelected = user
    ? open && activeId === LIVE_TRADE_DOCK_RAIL_TAB_IDS.auth
    : authPopoverOpen;
  const onAuthRailClick = () => {
    if (user) handleLogout();
    else setAuthPopoverOpen((v) => !v);
  };

  return (
    <div
      ref={dockRef}
      className={`app-live-trade-side-dock${
        open ? " app-live-trade-side-dock--open" : " app-live-trade-side-dock--collapsed"
      }${resizing ? " app-live-trade-side-dock--resizing" : ""}`}
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
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          aria-label={ko.app.liveTradeSideDockResize}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={panelWidthBounds.min}
          aria-valuemax={panelWidthBounds.max}
          aria-valuenow={panelWidthPx}
          title={ko.app.liveTradeSideDockResizeHint}
        >
          <DockResizeArrows />
        </button>
        <div
          id={LIVE_TRADE_RIGHT_PANEL_HOST_ID}
          className="app-live-trade-side-dock__host"
        >
          <LiveTradeCardSidePanel forceDocked railMode />
          {portalSource}
        </div>
      </div>
      <nav
        className="app-live-trade-side-dock__rail"
        aria-label={ko.app.liveTradeSideDockRailAria}
      >
        <button
          type="button"
          className="app-live-trade-side-dock__fold app-live-trade-side-dock__rail-btn"
          onClick={toggleFold}
          aria-expanded={open}
          aria-controls="app-live-trade-side-dock-panel"
          title={open ? ko.app.liveTradeSideDockCollapse : ko.app.liveTradeSideDockExpand}
        >
          <span
            className="app-live-trade-side-dock__rail-glyph app-live-trade-side-dock__rail-glyph--fold"
            aria-hidden
          >
            <DockFoldChevron open={open} />
          </span>
        </button>
        <div className="app-live-trade-side-dock__rail-tabs">
        {railTabs.map((tab) => {
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
          <span
            ref={authAnchorRef}
            className="app-live-trade-side-dock__auth-anchor"
          >
            <button
              type="button"
              className={
                authRailSelected
                  ? "app-live-trade-side-dock__rail-btn app-live-trade-side-dock__rail-btn--on app-live-trade-side-dock__rail-btn--auth"
                  : user
                    ? "app-live-trade-side-dock__rail-btn app-live-trade-side-dock__rail-btn--auth app-live-trade-side-dock__rail-btn--logout"
                    : "app-live-trade-side-dock__rail-btn app-live-trade-side-dock__rail-btn--auth"
              }
              aria-selected={authRailSelected}
              aria-expanded={!user ? authPopoverOpen : undefined}
              aria-haspopup={!user ? "dialog" : undefined}
              aria-controls={
                !user && authPopoverOpen
                  ? "app-live-trade-side-dock-auth-popover"
                  : user
                    ? "app-live-trade-side-dock-panel"
                    : undefined
              }
              title={
                user ? ko.app.liveTradeAuthLogout : ko.app.liveTradeSideDockRailAuth
              }
              onClick={onAuthRailClick}
            >
              <span className="app-live-trade-side-dock__rail-glyph" aria-hidden>
                {user ? "⎋" : "◎"}
              </span>
              <span className="app-live-trade-side-dock__rail-label">
                {user ? ko.app.liveTradeAuthLogout : ko.app.liveTradeSideDockRailAuth}
              </span>
            </button>
            {!user && authPopoverOpen ? (
              <div
                id="app-live-trade-side-dock-auth-popover"
                className="app-live-trade-side-dock__auth-popover"
                role="dialog"
                aria-label={ko.app.liveTradeAuthTitle}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <LiveTradeAuthPanel
                  user={null}
                  registrationOpen={registrationOpen}
                  variant="popover"
                  onAuthChange={onDockAuthChange}
                />
              </div>
            ) : null}
          </span>
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
