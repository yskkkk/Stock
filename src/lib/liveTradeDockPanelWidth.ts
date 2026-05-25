export const LIVE_TRADE_DOCK_PANEL_WIDTH_VAR = "--live-trade-dock-panel-width";
export const LIVE_TRADE_DOCK_PANEL_WIDTH_PREF =
  "ystock-live-trade-side-dock-panel-width-px";

const RAIL_REM = 3.25;
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

/** 패널 최소 너비(px) — `clampDockPanelWidthPx` 하한과 동일 */
export function minDockPanelWidthPx(viewportWidth?: number): number {
  return clampDockPanelWidthPx(0, viewportWidth);
}

/** 이 너비를 넘기면 도크 열림, 이하면 닫힘(드래그 스냅) */
export function dockPanelOpenSnapThresholdPx(viewportWidth?: number): number {
  return Math.round(minDockPanelWidthPx(viewportWidth) / 2);
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

/** 우측 레일 너비(px) — 드래그·닫기 판별과 CSS `--live-trade-dock-rail-width`와 맞춤 */
export function dockRailWidthPx(): number {
  return Math.round(RAIL_REM * rootFontPx());
}

/** 드래그 중 너비 — 0~max(최소 rem 클램프 없음, 닫기·스냅 판별용) */
export function dockPanelWidthDragPx(
  px: number,
  viewportWidth?: number,
): number {
  const root = rootFontPx();
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  const totalCap = Math.min(MAX_DOCK_TOTAL_REM * root, 0.42 * vw);
  const max = Math.max(0, totalCap - RAIL_REM * root);
  return Math.round(Math.min(max, Math.max(0, px)));
}

/** 닫힌 상태에서 핸들 드래그 — 포인터 X ~ 뷰포트 오른(레일 제외) */
export function dockPanelWidthFromExpandPointerRaw(
  clientX: number,
  viewportWidth?: number,
): number {
  const vw = viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1280);
  return vw - clientX - dockRailWidthPx();
}

export function dockPanelWidthFromExpandPointer(clientX: number): number {
  return dockPanelWidthDragPx(dockPanelWidthFromExpandPointerRaw(clientX));
}

/** 접힘 상태 — 핸들 잡은 X에서 왼쪽으로 끌어당긴 px만큼 패널 너비 */
export function dockPanelWidthFromCollapsedDrag(
  startX: number,
  clientX: number,
  viewportWidth?: number,
): number {
  return dockPanelWidthDragPx(Math.max(0, startX - clientX), viewportWidth);
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
