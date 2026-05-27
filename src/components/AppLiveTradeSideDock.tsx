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
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import LiveTradeDockApiRail from "./LiveTradeDockApiRail";
import LiveTradeDockYsHead from "./LiveTradeDockYsHead";
import { useDesktopDockLayout } from "../hooks/useDesktopDockLayout";
import { useNestedVerticalScroll } from "../hooks/useNestedVerticalScroll";
import { refreshLiveTradingStatusNow } from "../hooks/useLiveTradingStatusPoll";
import { invalidateLiveTradingPrefetch } from "../lib/tabPrefetch";
import { useLiveTradingStatusPoll } from "../hooks/useLiveTradingStatusPoll";
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
  LIVE_TRADE_DOCK_AFTER_FORM_SAVE_EVENT,
  LIVE_TRADE_DOCK_OPEN_EVENT,
  LIVE_TRADE_DOCK_TOGGLE_EVENT,
  dispatchLiveTradeDockOpenForm,
} from "../lib/liveTradeDockEvents";
import {
  dispatchLiveTradeDockProgramsPlain,
  dispatchLiveTradePortfolioPanelTab,
  LIVE_TRADE_DOCK_OPEN_PORTFOLIO_EVENT,
} from "../lib/liveTradePortfolioFocus";
import {
  LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
  LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT,
  LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT,
  dispatchDockAccountProvider,
  readDockAccountProvider,
  readDockAccountProviderEvent,
  readDockAccountViewEvent,
  type LiveTradeTradesExchange,
} from "../lib/liveTradeDockAccount";
import {
  LIVE_TRADE_DOCK_PANEL_WIDTH_PREF,
  applyDockPanelWidthCss,
  clampDockPanelWidthPx,
  clearDockPanelWidthCss,
  defaultDockPanelWidthPx,
  dockPanelOpenSnapThresholdPx,
  dockPanelWidthDragPx,
  dockPanelWidthFromCollapsedDrag,
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

function isScrollableY(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") return false;
  return el.scrollHeight > el.clientHeight + 2;
}

/** 펼친 패널 안 — 이벤트 지점에서 위로 올라가며 첫 스크롤 가능 조상 */
function findDockPanelScrollTarget(
  dock: HTMLElement,
  from: EventTarget | null,
): HTMLElement | null {
  let el: Element | null = from instanceof Element ? from : null;
  while (el && dock.contains(el)) {
    if (el instanceof HTMLElement && isScrollableY(el)) return el;
    el = el.parentElement;
  }
  const host = dock.querySelector<HTMLElement>(
    ".live-trading-tab__card-tabs-host:not(.live-trading-tab__card-tabs-host--idle)",
  );
  return host;
}

function applyScrollDelta(el: HTMLElement, delta: number): void {
  if (delta === 0) return;
  const max = el.scrollHeight - el.clientHeight;
  el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + delta));
}

/** 펼친 도크 패널 — 본문 `.app__scroll`과 분리, 패널 내부만 스크롤 */
function applyDockPanelWheelScroll(dock: HTMLElement, e: WheelEvent): void {
  const delta = wheelDeltaY(e);
  if (delta === 0) return;
  const target = findDockPanelScrollTarget(dock, e.target);
  if (target) applyScrollDelta(target, delta);
}

function isWheelInDockPanel(dock: HTMLElement | null, e: WheelEvent): boolean {
  if (!dock) return false;
  for (const node of e.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (dock.contains(node)) return true;
  }
  return false;
}

function isWheelInDockRail(e: WheelEvent): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (
      node.matches(
        "[data-live-trade-side-dock-rail], .app-live-trade-side-dock__rail--portal",
      ) ||
      node.closest("[data-live-trade-side-dock-rail]") ||
      node.closest(".app-live-trade-side-dock__rail--portal")
    ) {
      return true;
    }
  }
  return false;
}

function findRailScrollHost(from: EventTarget | null): HTMLElement | null {
  if (!from || !(from instanceof Element)) return null;
  const rail = from.closest<HTMLElement>("[data-live-trade-side-dock-rail]");
  return rail?.querySelector<HTMLElement>(".app-live-trade-side-dock__rail-scroll") ?? null;
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
  accountProvider: LiveTradeTradesExchange,
): { glyph: ReactNode; label: string; subLabel?: string; stacked?: boolean } {
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.auth) {
    return {
      glyph: "◎",
      label: loggedIn ? ko.app.liveTradeDockRailAccount : ko.app.liveTradeSideDockRailAuth,
    };
  }
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb) {
    const Mark =
      accountProvider === "toss" ? TossBrandMark : BithumbBrandMark;
    return {
      glyph: <Mark className="app-live-trade-side-dock__rail-bithumb-mark" />,
      label: ko.app.liveTradeDockRailAccountTab,
    };
  }
  if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.liveRail) {
    return { glyph: <DockRailBanknoteIcon />, label: ko.app.liveTradeLeftRailTitle };
  }
  if (id === "activity") {
    return { glyph: "▶", label: ko.app.liveTradeSideDockRailActivity };
  }
  if (id === "portfolio") {
    return {
      glyph: "₩",
      label: ko.app.liveTradeSideDockRailPortfolio,
      subLabel: ko.app.liveTradeDockRailPortfolioTrades,
      stacked: true,
    };
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
  pageScrollRef: _pageScrollRef = null,
}: {
  feedbackRef?: RefObject<FeedbackCornerHandle | null>;
  feedbackActive?: boolean;
  /** 보유·주문·프로그램 — 도크 본문 포털 소스 */
  portalSource?: ReactNode;
  /** 메인 페이지 스크롤(`.app__scroll`) — fixed 도크 휠 연동 */
  pageScrollRef?: RefObject<HTMLDivElement | null> | null;
}) {
  const { user, authChecked, registrationOpen } = useLiveTradeAuth();
  const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
  const [authPopoverStyle, setAuthPopoverStyle] = useState<CSSProperties>({});
  const authAnchorRef = useRef<HTMLSpanElement>(null);
  const ctx = useLiveTradeCardSidePanelOptional();
  const liveStatus = useLiveTradingStatusPoll();
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
  const [accountRailProvider, setAccountRailProvider] =
    useState<LiveTradeTradesExchange>(readDockAccountProvider);
  const dockRef = useRef<HTMLDivElement>(null);
  const railScrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const resizeHandleRef = useRef<HTMLButtonElement>(null);
  const resizeDragRef = useRef<{
    startX: number;
    startW: number;
    wasOpen: boolean;
    pointerId?: number;
  } | null>(null);

  const releaseResizeDrag = useCallback(() => {
    const drag = resizeDragRef.current;
    resizeDragRef.current = null;
    setResizing(false);
    const el = resizeHandleRef.current;
    const pid = drag?.pointerId;
    if (el == null || pid == null) return;
    try {
      if (el.hasPointerCapture(pid)) {
        el.releasePointerCapture(pid);
      }
    } catch {
      /* ignore */
    }
  }, []);

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

  const openDefaultDockPanel = useCallback(() => {
    if (!openPanel) return;
    const titles = defaultLiveTradeSideTabTitles();
    openPanel(
      LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb,
      titles[LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb] ?? ko.app.liveTradeDockRailAccountTab,
    );
  }, [openPanel]);

  const toggleFold = useCallback(() => {
    const next = !open;
    if (next) {
      persistOpen(true);
      openDefaultDockPanel();
      beginDockPanelOpenAnimation();
      return;
    }
    applyDockPanelWidthCss(0);
    persistOpen(false);
    window.setTimeout(() => {
      if (!openRef.current) clearDockPanelWidthCss();
    }, 240);
  }, [open, persistOpen, openDefaultDockPanel, beginDockPanelOpenAnimation]);

  useEffect(() => {
    const onToggle = () => toggleFold();
    window.addEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(LIVE_TRADE_DOCK_TOGGLE_EVENT, onToggle);
  }, [toggleFold]);

  useEffect(() => {
    const onOpen = () => {
      if (openRef.current) return;
      persistOpen(true);
      openDefaultDockPanel();
      beginDockPanelOpenAnimation();
    };
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(LIVE_TRADE_DOCK_OPEN_EVENT, onOpen);
  }, [persistOpen, openDefaultDockPanel, beginDockPanelOpenAnimation]);

  useEffect(() => {
    const onAfterFormSave = () => {
      releaseResizeDrag();
      setAuthPopoverOpen(false);
      window.dispatchEvent(new CustomEvent("live-trade-dock-close-api-popover"));
    };
    window.addEventListener(LIVE_TRADE_DOCK_AFTER_FORM_SAVE_EVENT, onAfterFormSave);
    return () =>
      window.removeEventListener(
        LIVE_TRADE_DOCK_AFTER_FORM_SAVE_EVENT,
        onAfterFormSave,
      );
  }, [releaseResizeDrag]);

  useEffect(() => {
    const onGlobalPointerEnd = () => releaseResizeDrag();
    window.addEventListener("pointerup", onGlobalPointerEnd);
    window.addEventListener("pointercancel", onGlobalPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onGlobalPointerEnd);
      window.removeEventListener("pointercancel", onGlobalPointerEnd);
    };
  }, [releaseResizeDrag]);

  useEffect(() => {
    const onOpenPortfolio = () => {
      if (!openPanel) return;
      dispatchLiveTradePortfolioPanelTab("trade");
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

  useEffect(() => {
    const onProvider = (e: Event) => {
      const p = readDockAccountProviderEvent(e);
      if (p === "bithumb" || p === "toss") setAccountRailProvider(p);
    };
    window.addEventListener(LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT, onProvider);
    return () =>
      window.removeEventListener(
        LIVE_TRADE_DOCK_ACCOUNT_PROVIDER_EVENT,
        onProvider,
      );
  }, []);

  useEffect(() => {
    const onOpenAccount = (e: Event) => {
      if (!openPanel) return;
      const view = readDockAccountViewEvent(e);
      if (view?.provider === "bithumb" || view?.provider === "toss") {
        setAccountRailProvider(view.provider);
      }
      const titles = defaultLiveTradeSideTabTitles();
      openPanel(
        LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb,
        titles[LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb] ??
          ko.app.liveTradeDockRailAccountTab,
      );
      requestAnimationFrame(() => {
        const v = readDockAccountViewEvent(e) ?? view;
        if (v) {
          window.dispatchEvent(
            new CustomEvent(LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT, { detail: v }),
          );
        }
      });
      if (!openRef.current) {
        persistOpen(true);
        beginDockPanelOpenAnimation();
      } else {
        applyDockPanelWidthCss(panelWidthPx);
      }
    };
    window.addEventListener(LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT, onOpenAccount);
    return () =>
      window.removeEventListener(LIVE_TRADE_DOCK_OPEN_ACCOUNT_EVENT, onOpenAccount);
  }, [openPanel, persistOpen, beginDockPanelOpenAnimation, panelWidthPx]);

  const activeId = panel?.id ?? null;

  const onRailTab = useCallback(
    (id: string, title: string) => {
      if (!openPanel) return;
      openPanel(id, title);
      if (!openRef.current) {
        persistOpen(true);
        beginDockPanelOpenAnimation();
      } else {
        applyDockPanelWidthCss(panelWidthPx);
      }
      if (id === "form" && activeId !== "form") {
        dispatchLiveTradeDockOpenForm();
      }
      if (id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb) {
        const togglingAccount =
          openRef.current && activeId === LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb;
        const next: LiveTradeTradesExchange = togglingAccount
          ? accountRailProvider === "bithumb"
            ? "toss"
            : "bithumb"
          : accountRailProvider;
        dispatchDockAccountProvider(next);
        setAccountRailProvider(next);
        window.dispatchEvent(
          new CustomEvent(LIVE_TRADE_DOCK_ACCOUNT_VIEW_EVENT, {
            detail: { provider: next },
          }),
        );
      } else if (id === "portfolio") {
        dispatchLiveTradePortfolioPanelTab("trade");
      } else if (id === "programs") {
        dispatchLiveTradeDockProgramsPlain();
      }
    },
    [
      openPanel,
      persistOpen,
      activeId,
      beginDockPanelOpenAnimation,
      panelWidthPx,
      accountRailProvider,
    ],
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
        pointerId: e.pointerId,
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
        openDefaultDockPanel();
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

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      resizeDragRef.current = null;
      setResizing(false);
    },
    [persistOpen, openDefaultDockPanel, syncDockPanelWidth],
  );

  useEffect(() => {
    if (!wide || !authChecked) return;

    const onWheel = (e: WheelEvent) => {
      const dock = dockRef.current;
      const open = openRef.current;

      if (open && dock && isWheelInDockPanel(dock, e)) {
        e.preventDefault();
        e.stopPropagation();
        applyDockPanelWheelScroll(dock, e);
        return;
      }

      if (isWheelInDockRail(e)) {
        const railScroll = findRailScrollHost(e.target);
        if (railScroll && isScrollableY(railScroll)) {
          e.preventDefault();
          e.stopPropagation();
          applyScrollDelta(railScroll, wheelDeltaY(e));
        }
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [wide, authChecked]);

  useNestedVerticalScroll(
    railScrollRef,
    wide && authChecked,
    "app-live-trade-side-dock__rail-scroll--dragging",
  );

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

  const dockRail = (
    <nav
      className={[
        "app-live-trade-side-dock__rail app-live-trade-side-dock__rail--portal",
        open
          ? "app-live-trade-side-dock__rail--dock-open"
          : "app-live-trade-side-dock__rail--dock-collapsed",
      ].join(" ")}
      data-live-trade-side-dock-rail
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
      <div
        ref={railScrollRef}
        className="app-live-trade-side-dock__rail-scroll"
      >
      <div className="app-live-trade-side-dock__rail-tabs">
        {railTabs.map((tab) => {
          const selected = open && activeId === tab.id;
          const isAccountTab = tab.id === LIVE_TRADE_DOCK_RAIL_TAB_IDS.bithumb;
          const { glyph, label, subLabel, stacked } = railTabShort(
            tab.id,
            tab.title,
            Boolean(user),
            accountRailProvider,
          );
          return (
            <button
              key={tab.id}
              type="button"
              className={[
                "app-live-trade-side-dock__rail-btn",
                selected ? "app-live-trade-side-dock__rail-btn--on" : "",
                isAccountTab ? "app-live-trade-side-dock__rail-btn--bithumb" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-selected={selected}
              aria-controls="app-live-trade-side-dock-panel"
              title={tab.title}
              onClick={() => onRailTab(tab.id, tab.title)}
            >
              <span
                className={
                  isAccountTab
                    ? "app-live-trade-side-dock__rail-glyph app-live-trade-side-dock__rail-glyph--bithumb"
                    : "app-live-trade-side-dock__rail-glyph"
                }
                aria-hidden
              >
                {glyph}
              </span>
              <span
                className={[
                  "app-live-trade-side-dock__rail-label",
                  isAccountTab
                    ? "app-live-trade-side-dock__rail-label--accounts"
                    : "",
                  stacked ? "app-live-trade-side-dock__rail-label--stacked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {stacked && subLabel ? (
                  <>
                    <span className="app-live-trade-side-dock__rail-label-main">
                      {label}
                    </span>
                    <span className="app-live-trade-side-dock__rail-label-sub">
                      {subLabel}
                    </span>
                  </>
                ) : (
                  label
                )}
              </span>
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
        <span ref={authAnchorRef} className="app-live-trade-side-dock__auth-anchor">
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
                <LiveTradeDockYsHead ariaLabel={ko.app.liveTradeAuthTitle} />
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
      </div>
    </nav>
  );

  return (
    <>
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
          ref={resizeHandleRef}
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
          onLostPointerCapture={releaseResizeDrag}
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
    </div>
    {typeof document !== "undefined"
      ? createPortal(dockRail, document.body)
      : dockRail}
    </>
  );
}
