export const LIVE_TRADE_DOCK_PANEL_WIDTH_VAR = "--live-trade-dock-panel-width";
export const LIVE_TRADE_DOCK_PANEL_WIDTH_PREF =
  "ystock-live-trade-side-dock-panel-width-px";

const RAIL_REM = 3.35;
const DEFAULT_PANEL_REM = 26;
const MIN_PANEL_REM = 14;
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

export function readDockPanelWidthPref(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LIVE_TRADE_DOCK_PANEL_WIDTH_PREF);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clampDockPanelWidthPx(n);
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
