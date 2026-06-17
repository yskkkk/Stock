import type { CSSProperties } from "react";
import { DESKTOP_DOCK_LAYOUT_MQ } from "../hooks/useDesktopDockLayout";

const DEFAULT_GAP_PX = 9;
const MOBILE_POPOVER_EST_WIDTH_PX = 300;

function mobileDockBarReservePx(): number {
  if (typeof document === "undefined") return 52;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--mobile-dock-bar-height")
    .trim();
  const rem = parseFloat(raw);
  const base = Number.isFinite(rem) && rem > 0 ? rem * 16 : 52;
  return base + 8;
}

/** 모바일 하단 도크 — 팝오버를 화면 안(도크 위)에 고정 */
export function dockRailPopoverPortalStyle(
  anchor: HTMLElement,
  gapPx = DEFAULT_GAP_PX,
  estWidthPx = MOBILE_POPOVER_EST_WIDTH_PX,
): CSSProperties {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mobile =
    typeof window !== "undefined" &&
    !window.matchMedia(DESKTOP_DOCK_LAYOUT_MQ).matches;

  if (mobile) {
    const pad = 8;
    const maxW = Math.min(estWidthPx, vw - pad * 2);
    const centerX = r.left + r.width / 2;
    const left = Math.max(pad, Math.min(vw - pad - maxW, centerX - maxW / 2));
    const bottom = Math.max(
      pad,
      vh - r.top + gapPx,
      mobileDockBarReservePx(),
    );
    return {
      position: "fixed",
      left,
      right: "auto",
      bottom,
      top: "auto",
      width: maxW,
      maxWidth: `min(22rem, calc(100vw - ${pad * 2}px))`,
      maxHeight: `min(70dvh, calc(100dvh - ${bottom + pad}px))`,
    };
  }

  return {
    position: "fixed",
    right: Math.max(8, vw - r.left + gapPx),
    bottom: Math.max(8, vh - r.bottom),
  };
}
