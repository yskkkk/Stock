import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { logoutAuth } from "../api";
import { FeedbackDockRailButton, type FeedbackCornerHandle } from "./FeedbackCorner";
import LiveTradeDockApiRail from "./LiveTradeDockApiRail";
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
import { LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT } from "../lib/liveTradePortfolioFocus";
import {
  LIVE_TRADE_DOCK_PANEL_WIDTH_PREF,
  applyDockPanelWidthCss,
  clampDockPanelWidthPx,
  clearDockPanelWidthCss,
  defaultDockPanelWidthPx,
  dockPanelOpenSnapThresholdPx,
  dockPanelWidthDragPx,
  dockPanelWidthFromCollapsedDrag,
  dockRailWidthPx,
  minDockPanelWidthPx,
  persistDockPanelWidthPref,
  readDockPanelWidthPref,
} from "../lib/liveTradeDockPanelWidth";

const AUTH_POPOVER_GAP_PX = 9;

function isUsablePointerClientX(clientX: number): boolean {
  if (!Number.isFinite(clientX)) return false;
  if (typeof window === "undefined") return true;
  return clientX >= -32 && clientX <= window.innerWidth + 32;
}

function dockPanelWidthFromOpenDrag(
  startW: number,
  startX: number,
  clientX: number,
  viewportWidth?: number,
): number {
  return dockPanelWidthDragPx(startW + (startX - clientX), viewportWidth);
}

function authPopoverPortalStyle(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect();
  return {
    right: Math.max(8, window.innerWidth - r.left + AUTH_POPOVER_GAP_PX),
    bottom: Math.max(8, window.innerHeight - r.bottom),
  };
}

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

function findAppScrollEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app__scroll");
}

function findDockPanelScrollEl(dock: HTMLElement): HTMLElement | null {
  const host = dock.querySelector<HTMLElement>(".app-live-trade-side-dock__host");
  if (!host) return null;

  const tabsHost = host.querySelector<HTMLElement>(
    ".live-trading-tab__card-tabs-host:not(.live-trading-tab__card-tabs-host--idle)",
  );
  if (tabsHost) {
    if (isScrollable(tabsHost)) return tabsHost;
    const nested = findNestedScrollable(tabsHost);
    if (nested) return nested;
  }

  const body = host.querySelector<HTMLElement>(
    ".live-trading-tab__card-tabs-pane--active .live-trading-tab__card-tabs-body",
  );
  if (body && isScrollable(body)) return body;

  const nestedInHost = findNestedScrollable(host);
  if (nestedInHost) return nestedInHost;

  const panel = dock.querySelector<HTMLElement>(".app-live-trade-side-dock__panel");
  if (panel) {
    const nestedInPanel = findNestedScrollable(panel);
    if (nestedInPanel) return nestedInPanel;
  }

  return tabsHost ?? body ?? null;
}

/** 메인 `.app__scroll` — 레일·접힌 보색 핸들 */
function applyPageScrollWheel(scrollEl: HTMLElement, e: WheelEvent): boolean {
  const delta = wheelDeltaY(e);
  if (delta === 0) return false;

  const max = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (max <= 0) return false;

  const top = scrollEl.scrollTop;
  if (delta > 0 && top >= max - 0.5) return false;
  if (delta < 0 && top <= 0.5) return false;

  scrollEl.scrollTop = Math.max(0, Math.min(max, top + delta));
  return true;
}

/** 도크 패널 내부만 스크롤 — 끝에 닿아도 메인으로 체인하지 않음 */
function applyDockPanelWheel(scrollEl: HTMLElement, e: WheelEvent): void {
  const delta = wheelDeltaY(e);
  if (delta === 0) return;

  const max = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (max <= 0) return;

  const top = scrollEl.scrollTop;
  if (delta > 0 && top >= max - 0.5) return;
  if (delta < 0 && top <= 0.5) return;

  scrollEl.scrollTop = Math.max(0, Math.min(max, top + delta));
}

/** 우측 아이콘 레일(빨간 마킹 구간) — 페이지 스크롤 */
function isWheelOnDockRailZone(
  dock: HTMLElement,
  target: EventTarget | null,
  panelOpen: boolean,
): boolean {
  if (!target || !(target instanceof Node)) return false;
  const rail = dock.querySelector<HTMLElement>(".app-live-trade-side-dock__rail");
  if (rail?.contains(target)) return true;
  if (!panelOpen) {
    const handle = dock.querySelector<HTMLElement>(
      ".app-live-trade-side-dock__resize-handle",
    );
    if (handle?.contains(target)) return true;
  }
  return false;
}

/** 펼친 패널 본문·헤더·보색 핸들 — 패널만 스크롤 */
function isWheelInOpenDockPanel(
  dock: HTMLElement,
  target: EventTarget | null,
  panelOpen: boolean,
): boolean {
  if (!panelOpen || !target || !(target instanceof Node)) return false;
  const panel = dock.querySelector<HTMLElement>(".app-live-trade-side-dock__panel");
  return Boolean(panel?.contains(target));
}

/** 접힘=왼쪽, 펼침=오른쪽 */
function DockFoldChevron({ open }: { open: boolean }) {
  return (
    <svg
      className="app-live-trade-side-dock__chevron-svg"
      viewBox="0 0 24 24"
      width={14}
      height={14}
      aria-hidden
    >
      <path
        d={open ? "M10 7l5 5-5 5" : "M14 7l-5 5 5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DockRailBanknoteIcon() {
  return (
    <svg
      className="app-live-trade-side-dock__rail-icon"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden
    >
      <rect
        x="3"
        y="6"
        width="18"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r="2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M6 9.5h2M6 14.5h2M16 9.5h2M16 14.5h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DockRailWebsiteIcon() {
  return (
    <svg
      className="app-live-trade-side-dock__rail-icon"
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden
    >
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M4 9h16" stroke="currentColor" strokeWidth="2" />
      <circle cx="7" cy="7" r="0.85" fill="currentColor" />
      <circle cx="9.75" cy="7" r="0.85" fill="currentColor" />
      <path
        d="M8 13h8M8 16h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function railTabShort(
  id: string,
  title: string,
  loggedIn: boolean,
): { glyph: ReactNode; label: string } {
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
    return { glyph: <DockRailBanknoteIcon />, label: ko.app.liveTradeLeftRailTitle };
  }
  if (id === "portfolio") {
    return { glyph: "₩", label: ko.app.liveTradeSideDockRailPortfolio };
  }
  if (id === "form") {
    return { glyph: <DockRailWebsiteIcon />, label: ko.app.liveTradeSideDockRailForm };
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
  const [authPopoverStyle, setAuthPopoverStyle] = useState<CSSProperties>({});
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
  const [open, setOpen] = useState(false);
  const [panelWidthPx, setPanelWidthPx] = useState(() => {
    const saved = readDockPanelWidthPref();
    return saved ?? defaultDockPanelWidthPx();
  });
  const [resizing, setResizing] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const resizeDragRef = useRef<{
    startX: number;
    startW: number;
    wasOpen: boolean;
  } | null>(null);
  const panelWidthBounds = useMemo(
    () => ({
      min: clampDockPanelWidthPx(0),
      max: clampDockPanelWidthPx(99999),
    }),
    [],
  );

  const syncDockPanelWidth = useCallback((px: number) => {
    const w = clampDockPanelWidthPx(px);
    applyDockPanelWidthCss(w);
    setPanelWidthPx(w);
    return w;
  }, []);

  const persistOpen = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const beginDockPanelOpenAnimation = useCallback(() => {
    applyDockPanelWidthCss(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyDockPanelWidthCss(panelWidthPx);
      });
    });
  }, [panelWidthPx]);

  useEffect(() => {
    if (!panel?.id || openRef.current) return;
    persistOpen(true);
    beginDockPanelOpenAnimation();
  }, [panel?.id, persistOpen, beginDockPanelOpenAnimation]);

  const openDefaultBithumbPanel = useCallback(() => {
    if (!openPanel) return;
    const titles = defaultLiveTradeSideTabTitles();
    openPanel(
      LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb,
      titles[LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb] ?? ko.app.leftRailBithumbAccountTitle,
    );
  }, [openPanel]);

  const toggleFold = useCallback(() => {
    const next = !open;
    if (next) {
      persistOpen(true);
      openDefaultBithumbPanel();
      beginDockPanelOpenAnimation();
      return;
    }
    applyDockPanelWidthCss(0);
    persistOpen(false);
    window.setTimeout(() => {
      if (!openRef.current) clearDockPanelWidthCss();
    }, 240);
  }, [open, persistOpen, openDefaultBithumbPanel, beginDockPanelOpenAnimation]);

  useEffect(() => {
    const onToggle = () => toggleFold();
    window.addEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
  }, [toggleFold]);

  useEffect(() => {
    const onOpenPortfolio = () => {
      if (!openPanel) return;
      const titles = defaultLiveTradeSideTabTitles();
      openPanel("portfolio", titles.portfolio ?? ko.app.liveTradePfTitle);
      persistOpen(true);
      beginDockPanelOpenAnimation();
    };
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT, onOpenPortfolio);
    return () =>
      window.removeEventListener(
        LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT,
        onOpenPortfolio,
      );
  }, [openPanel, persistOpen, beginDockPanelOpenAnimation]);

  const activeId = panel?.id ?? null;

  const onRailTab = useCallback(
    (id: string, title: string) => {
      if (!openPanel) return;
      if (id === "form" && activeId !== "form") {
        dispatchLiveTradeDockOpenForm();
      }
      openPanel(id, title);
      if (!openRef.current) {
        persistOpen(true);
        beginDockPanelOpenAnimation();
      } else {
        applyDockPanelWidthCss(panelWidthPx);
      }
    },
    [openPanel, persistOpen, activeId, beginDockPanelOpenAnimation, panelWidthPx],
  );

  const handleLogout = useCallback(() => {
    void logoutAuth()
      .then(() => {
        invalidateLiveTradingPrefetch();
        refreshLiveTradingStatusNow();
        notifyLiveTradeAuthChange();
        setAuthPopoverOpen(false);
        closePanel?.();
        persistOpen(false);
        clearDockPanelWidthCss();
      })
      .catch(() => {});
  }, [closePanel, persistOpen]);

  const onDockAuthChange = useCallback(() => {
    invalidateLiveTradingPrefetch();
    refreshLiveTradingStatusNow();
    notifyLiveTradeAuthChange();
    setAuthPopoverOpen(false);
  }, []);

  const syncAuthPopoverPosition = useCallback(() => {
    const anchor = authAnchorRef.current;
    if (!anchor) return;
    setAuthPopoverStyle(authPopoverPortalStyle(anchor));
  }, []);

  useLayoutEffect(() => {
    if (!authPopoverOpen) return;
    syncAuthPopoverPosition();
    window.addEventListener("resize", syncAuthPopoverPosition);
    window.addEventListener("scroll", syncAuthPopoverPosition, true);
    return () => {
      window.removeEventListener("resize", syncAuthPopoverPosition);
      window.removeEventListener("scroll", syncAuthPopoverPosition, true);
    };
  }, [authPopoverOpen, open, resizing, syncAuthPopoverPosition]);

  useEffect(() => {
    if (!authPopoverOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (authAnchorRef.current?.contains(t)) return;
      if (
        document
          .getElementById("app-live-trade-side-dock-auth-popover")
          ?.contains(t)
      ) {
        return;
      }
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

  useLayoutEffect(() => {
    if (!open && !resizing) {
      clearDockPanelWidthCss();
      return;
    }
    if (resizing) return;
    const w = getComputedStyle(document.documentElement).getPropertyValue(
      "--live-trade-dock-panel-width",
    );
    if (open && (w === "0px" || w === "0")) return;
    applyDockPanelWidthCss(panelWidthPx);
  }, [open, resizing, panelWidthPx]);

  useEffect(() => {
    const saved = readDockPanelWidthPref();
    if (saved != null) return;
    const def = defaultDockPanelWidthPx();
    setPanelWidthPx((w) => (w < def * 0.72 ? def : w));
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPanelWidthPx((w) => clampDockPanelWidthPx(w));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onResizePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const wasOpen = open;
      const startW = wasOpen ? panelWidthPx : 0;
      resizeDragRef.current = {
        startX: e.clientX,
        startW,
        wasOpen,
      };
      if (wasOpen) {
        applyDockPanelWidthCss(startW);
      } else {
        applyDockPanelWidthCss(0);
        setPanelWidthPx(0);
      }
      setResizing(true);
    },
    [open, panelWidthPx],
  );

  const onResizePointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || !isUsablePointerClientX(e.clientX)) return;
      const vw = window.innerWidth;
      const next = drag.wasOpen
        ? dockPanelWidthFromOpenDrag(drag.startW, drag.startX, e.clientX, vw)
        : dockPanelWidthFromCollapsedDrag(drag.startX, e.clientX, vw);
      applyDockPanelWidthCss(next);
      setPanelWidthPx(next);
    },
    [],
  );

  const finishResize = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      resizeDragRef.current = null;

      const snapHalf = dockPanelOpenSnapThresholdPx();
      const min = minDockPanelWidthPx();
      const clientX = isUsablePointerClientX(e.clientX) ? e.clientX : drag.startX;
      const w = drag.wasOpen
        ? dockPanelWidthFromOpenDrag(drag.startW, drag.startX, clientX)
        : dockPanelWidthFromCollapsedDrag(drag.startX, clientX);

      const restoreWidth = () =>
        readDockPanelWidthPref() ?? defaultDockPanelWidthPx();

      if (w <= snapHalf) {
        persistOpen(false);
        clearDockPanelWidthCss();
        setPanelWidthPx(restoreWidth());
      } else {
        const finalW = syncDockPanelWidth(Math.max(w, min));
        persistOpen(true);
        openDefaultBithumbPanel();
        if (finalW >= defaultDockPanelWidthPx() * 0.72) {
          persistDockPanelWidthPref(finalW);
        } else {
          try {
            localStorage.removeItem(LIVE_TRADE_DOCK_PANEL_WIDTH_PREF);
          } catch {
            /* ignore */
          }
        }
      }

      setResizing(false);

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [persistOpen, openDefaultBithumbPanel, syncDockPanelWidth],
  );

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const onWheel = (e: WheelEvent) => {
      if (!dock.contains(e.target as Node)) return;

      const panelOpen = openRef.current;

      if (isWheelOnDockRailZone(dock, e.target, panelOpen)) {
        const pageScroll = findAppScrollEl();
        if (pageScroll && applyPageScrollWheel(pageScroll, e)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (isWheelInOpenDockPanel(dock, e.target, panelOpen)) {
        const scrollEl = findDockPanelScrollEl(dock);
        if (scrollEl) applyDockPanelWheel(scrollEl, e);
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
    else {
      setAuthPopoverOpen((v) => !v);
      window.dispatchEvent(new CustomEvent("live-trade-dock-close-api-popover"));
    }
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
          className={[
            "app-live-trade-side-dock__resize-handle",
            open ? "" : "app-live-trade-side-dock__resize-handle--collapsed",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          aria-label={
            open ? ko.app.liveTradeSideDockResize : ko.app.liveTradeSideDockExpand
          }
          role={open ? "separator" : "button"}
          aria-orientation={open ? "vertical" : undefined}
          aria-valuemin={open ? panelWidthBounds.min : undefined}
          aria-valuemax={open ? panelWidthBounds.max : undefined}
          aria-valuenow={open ? panelWidthPx : undefined}
          aria-expanded={open ? undefined : false}
          title={
            open ? ko.app.liveTradeSideDockResizeHint : ko.app.liveTradeSideDockExpand
          }
        />
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
          {user ? (
            <LiveTradeDockApiRail
              user={user}
              onCredentialsUpdated={onDockAuthChange}
              onPopoverOpen={() => setAuthPopoverOpen(false)}
            />
          ) : null}
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
          </span>
          {!user && authPopoverOpen
            ? createPortal(
                <div
                  id="app-live-trade-side-dock-auth-popover"
                  className="app-live-trade-side-dock__auth-popover app-live-trade-side-dock__auth-popover--portal"
                  style={authPopoverStyle}
                  role="dialog"
                  aria-label={ko.app.liveTradeAuthTitle}
                  onMouseDown={(ev) => ev.stopPropagation()}
                >
                  <LiveTradeAuthPanel
                    user={null}
                    registrationOpen={registrationOpen}
                    variant="popover"
                    onAuthChange={onDockAuthChange}
                  />
                </div>,
                document.body,
              )
            : null}
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
