import { useEffect, type RefObject } from "react";

const DESKTOP_MQ = "(min-width: 1180px)";
/** 목표 문서 top이 실제 스크롤 위치를 따라잡는 속도 */
const ANCHOR_LERP = 0.0182;
/** 화면에 그려지는 top */
const POSITION_LERP = 0.0286;

function readPadTop(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.max(6, root * 0.35);
}

/** 좌상단 고정 테마 블록 높이 — 레일과 겹치지 않게 최소 top 여백 */
function readThemeReserve(): number {
  if (!window.matchMedia(DESKTOP_MQ).matches) return 0;
  const corner = document.querySelector<HTMLElement>(".app-theme-corner--fixed");
  if (!corner) return 0;
  const h = corner.getBoundingClientRect().height;
  return h > 0 ? h + 10 : 0;
}

/** 스크롤 문서 안에서 뷰포트 세로 중앙에 오는 top */
function idealDocTop(scrollTop: number, railHeight: number): number {
  const vh = window.innerHeight;
  const minTop = Math.max(readPadTop(), readThemeReserve());
  return scrollTop + Math.max(minTop, (vh - railHeight) / 2);
}

/**
 * 왼쪽 레일: fixed가 아니라 문서 좌표로 두고,
 * 스크롤해도 anchor가 늦게 따라온 뒤 천천히 제자리(뷰포트 중앙)로 맞춤.
 */
export function useLeftRailLazyFollow(
  railRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const mq = window.matchMedia(DESKTOP_MQ);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anchorLerp = reduceMotion ? 0.286 : ANCHOR_LERP;
    const positionLerp = reduceMotion ? 0.338 : POSITION_LERP;

    let rafId = 0;
    let anchorTop = 0;
    let currentTop = 0;
    let active = false;

    const getScrollEl = () => scrollRef.current;

    const applyTop = (px: number) => {
      const y = `${px}px`;
      rail.style.setProperty("--app-left-rail-y", y);
      rail.style.top = y;
    };

    const clearTop = () => {
      rail.style.removeProperty("--app-left-rail-y");
      rail.style.removeProperty("top");
    };

    const syncIdeal = () => {
      const scrollTop = getScrollEl()?.scrollTop ?? 0;
      const h = rail.getBoundingClientRect().height;
      const ideal = idealDocTop(scrollTop, h);
      anchorTop = ideal;
      currentTop = ideal;
      applyTop(currentTop);
    };

    const tick = () => {
      if (!active || !mq.matches) {
        rafId = 0;
        return;
      }

      const scrollTop = getScrollEl()?.scrollTop ?? 0;
      const h = rail.getBoundingClientRect().height;
      const ideal = idealDocTop(scrollTop, h);

      anchorTop += (ideal - anchorTop) * anchorLerp;

      const diff = anchorTop - currentTop;
      if (Math.abs(diff) < 0.25) {
        currentTop = anchorTop;
      } else {
        currentTop += diff * positionLerp;
      }

      applyTop(currentTop);
      rafId = requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (!mq.matches || !active) return;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      ensureLoop();
    };

    const onResize = () => {
      if (!mq.matches) return;
      syncIdeal();
      ensureLoop();
    };

    const start = () => {
      if (!mq.matches) {
        active = false;
        clearTop();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      active = true;
      syncIdeal();
      ensureLoop();
    };

    const stop = () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearTop();
    };

    const onMq = () => (mq.matches ? start() : stop());

    const ro = new ResizeObserver(() => onResize());
    const themeCorner = document.querySelector<HTMLElement>(".app-theme-corner--fixed");

    start();
    ro.observe(rail);
    themeCorner && ro.observe(themeCorner);
    mq.addEventListener("change", onMq);
    getScrollEl()?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      getScrollEl()?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [railRef, scrollRef]);
}
