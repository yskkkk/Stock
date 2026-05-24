export const LIVE_TRADE_DOCK_PANEL_WIDTH_VAR = "--live-trade-dock-panel-width";
export const LIVE_TRADE_DOCK_PANEL_WIDTH_PREF =
  "ystock-live-trade-side-dock-panel-width-px";

const RAIL_REM = 3.35;
const DEFAULT_PANEL_REM = 26;
/** 드래그·저장 하한 — 이보다 좁으면 패널 본문이 거의 보이지 않음 */
const MIN_PANEL_REM = 20;
const MAX_DOCK_TOTAL_REM = 30;

function rootFontPx(): number {
  if (typeof document === "undefined") return 16;
  const n = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(n) && n > 0 ? n : 16;
}

export function defaultDockPanelWidthPx(viewportWidth?: number): number {
  const root = rootFontPx();
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const fromVw = 0.42 * vw - RAIL_REM * root;
  return Math.round(Math.min(DEFAULT_PANEL_REM * root, fromVw));
}

export function clampDockPanelWidthPx(
  px: number,
  viewportWidth?: number,
): number {
  const root = rootFontPx();
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const min = MIN_PANEL_REM * root;
  const totalCap = Math.min(MAX_DOCK_TOTAL_REM * root, 0.42 * vw);
  const max = Math.max(min, totalCap - RAIL_REM * root);
  return Math.round(Math.min(max, Math.max(min, px)));
}

/** 저장값이 기본 대비 지나치게 좁으면 무시(과거 최소 14rem·오동작 저장 복구) */
export function isDockPanelWidthPrefUsable(
  px: number,
  viewportWidth?: number,
): boolean {
  const def = defaultDockPanelWidthPx(viewportWidth);
  const floor = Math.max(def * 0.72, MIN_PANEL_REM * rootFontPx());
  return px >= floor;
}

export function readDockPanelWidthPref(viewportWidth?: number): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LIVE_TRADE_DOCK_PANEL_WIDTH_PREF);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!isDockPanelWidthPrefUsable(n, viewportWidth)) {
      localStorage.removeItem(LIVE_TRADE_DOCK_PANEL_WIDTH_PREF);
      return null;
    }
    return clampDockPanelWidthPx(n, viewportWidth);
  } catch {
    return null;
  }
}

export function persistDockPanelWidthPref(px: number): void {
  try {
    localStorage.setItem(LIVE_TRADE_DOCK_PANEL_WIDTH_PREF, String(px));
  } catch {
    /* ignore */
  }
}

export function applyDockPanelWidthCss(px: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    LIVE_TRADE_DOCK_PANEL_WIDTH_VAR,
    `${px}px`,
  );
}

export function clearDockPanelWidthCss(): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty(LIVE_TRADE_DOCK_PANEL_WIDTH_VAR);
}
