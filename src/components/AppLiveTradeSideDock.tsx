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
  if (typeof localStorage === "undefined") return true;
  try {
    const v = localStorage.getItem(OPEN_PREF_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

/** 운영 제외 전 탭 — 실매매 카드 상세를 그리드 밖 고정 오버레이로 표시 */
export default function AppLiveTradeSideDock() {
  const { user } = useLiveTradeAuth();
  const ctx = useLiveTradeCardSidePanelOptional();
  const sideTabs = ctx?.sideTabs ?? [];
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

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(OPEN_PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  if (!user || !wide || sideTabs.length === 0) return null;

  return (
    <div
      className={`app-live-trade-side-dock${
        open ? " app-live-trade-side-dock--open" : " app-live-trade-side-dock--collapsed"
      }`}
      data-live-trade-side-dock
    >
      <button
        type="button"
        className="app-live-trade-side-dock__toggle"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="app-live-trade-side-dock-panel"
        title={open ? ko.app.liveTradeSideDockCollapse : ko.app.liveTradeSideDockExpand}
      >
        <span className="app-live-trade-side-dock__toggle-icon" aria-hidden>
          {open ? "›" : "‹"}
        </span>
        <span className="app-live-trade-side-dock__toggle-label">
          {open ? ko.app.liveTradeSideDockCollapse : ko.app.liveTradeSideDockExpand}
        </span>
      </button>
      <div
        id="app-live-trade-side-dock-panel"
        className="app-live-trade-side-dock__panel"
        aria-hidden={!open}
      >
        <div
          id={LIVE_TRADE_RIGHT_PANEL_HOST_ID}
          className="app-live-trade-side-dock__host"
        >
          <LiveTradeCardSidePanel forceDocked />
        </div>
      </div>
    </div>
  );
}
