import { useCallback, useEffect, useState } from "react";
import {
  LIVE_TRADE_RIGHT_PANEL_HOST_ID,
  LiveTradeCardSidePanel,
  useLiveTradeAuth,
  useLiveTradeCardSidePanelOptional,
} from "./LiveTradeAuthAndCredentials";
import { ko } from "../i18n/ko";

const OPEN_PREF_KEY = "ystock-live-trade-side-dock-open";
const DOCK_MQ = "(min-width: 1180px)";

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

function railTabShort(id: string, title: string): { glyph: string; label: string } {
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
export default function AppLiveTradeSideDock() {
  const { user } = useLiveTradeAuth();
  const ctx = useLiveTradeCardSidePanelOptional();
  const sideTabs = ctx?.sideTabs ?? [];
  const panel = ctx?.panel ?? null;
  const openPanel = ctx?.openPanel;
  const closePanel = ctx?.closePanel;
  const [open, setOpen] = useState(readDockOpenPref);
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DOCK_MQ).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(DOCK_MQ);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  const onRailTab = useCallback(
    (id: string, title: string) => {
      if (!openPanel || !closePanel) return;
      const selected = panel?.id === id && open;
      if (selected) {
        persistOpen(false);
        closePanel();
        return;
      }
      openPanel(id, title);
      persistOpen(true);
    },
    [openPanel, closePanel, panel?.id, open, persistOpen],
  );

  if (!user || !wide || sideTabs.length === 0) return null;

  const activeId = panel?.id ?? null;

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
        {sideTabs.map((tab) => {
          const selected = open && activeId === tab.id;
          const { glyph, label } = railTabShort(tab.id, tab.title);
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
      </nav>
    </div>
  );
}
