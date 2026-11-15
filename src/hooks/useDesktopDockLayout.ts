import { useEffect, useState } from "react";

/** Viewport 3열·좌측 레일 분기(기존 1180px — 좌측 열 레이아웃 유지) */
export const DESKTOP_DOCK_LAYOUT_MQ = "(min-width: 1180px)";

/**
 * 우측 실매매 도크 — PC는 우측 고정.
 * 1180 미만이어도 마우스/트랙패드(PC)면 우측 유지.
 * 터치 폰·좁은 창만 하단 도크(`--mobile` / `--mobile-bottom`).
 * 모바일 max-width:1179 CSS 블록·시각 레이아웃은 그대로 두고, 클래스 유무로만 갈라진다.
 */
export const DESKTOP_SIDE_DOCK_MQ =
  "(min-width: 1180px), ((hover: hover) and (pointer: fine))";

function matchesMq(query: string): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia(query).matches
  );
}

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesMq(query));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** 우측 도크·좌측 계정 카드 분기(1180px 이상) — App 뷰포트/좌측 열용 */
export function useDesktopDockLayout(): boolean {
  return useMatchMedia(DESKTOP_DOCK_LAYOUT_MQ);
}

/** 우측 사이드 도크만 — PC(fine pointer)는 폭과 무관하게 우측 고정 */
export function useDesktopSideDockLayout(): boolean {
  return useMatchMedia(DESKTOP_SIDE_DOCK_MQ);
}
