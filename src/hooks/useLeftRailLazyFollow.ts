import { useEffect, type RefObject } from "react";

const DESKTOP_MQ = "(min-width: 1180px)";
/** 현재 Y → 목표 Y (낮을수록 더 늦게 따라옴) */
const POSITION_LERP = 0.055;
/** 스크롤 위치 스무딩 (낮을수록 스크롤 대비 더 지연) */
const SCROLL_SMOOTH = 0.065;
/** 지연된 스크롤 차이를 세로 이동으로 반영 */
const SCROLL_DRAG = 0.42;
const MAX_DRAG_PX = 110;

function readPadPx(): { top: number; bottom: number } {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return { top: Math.max(6, root * 0.35), bottom: 10 };
}

function centerTop(railHeight: number): number {
  const vh = window.innerHeight;
  const { top: padTop, bottom: padBottom } = readPadPx();
  const ideal = (vh - railHeight) / 2;
  return Math.max(padTop, Math.min(ideal, vh - railHeight - padBottom));
}

/**
 * 데스크톱 왼쪽 레일: 뷰포트 세로 중앙 기준 + 스크롤 이동 시 느리게 따라옴.
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
    const positionLerp = reduceMotion ? 0.28 : POSITION_LERP;
    const scrollSmooth = reduceMotion ? 0.22 : SCROLL_SMOOTH;
    const scrollDrag = reduceMotion ? 0.2 : SCROLL_DRAG;

    let rafId = 0;
    let currentY = 0;
    let smoothScroll = 0;
    let active = false;
    const scrollEl = scrollRef.current;

    const applyY = (y: number) => {
      rail.style.setProperty("--app-left-rail-y", `${y}px`);
    };

    const clearY = () => {
      rail.style.removeProperty("--app-left-rail-y");
    };

    const tick = () => {
      if (!active || !mq.matches) {
        rafId = 0;
        return;
      }

      const scrollTop = scrollEl?.scrollTop ?? 0;
      smoothScroll += (scrollTop - smoothScroll) * scrollSmooth;

      const h = rail.getBoundingClientRect().height;
      const drag = Math.max(
        -MAX_DRAG_PX,
        Math.min(MAX_DRAG_PX, (scrollTop - smoothScroll) * scrollDrag),
      );
      const target = centerTop(h) + drag;
      const diff = target - currentY;

      if (Math.abs(diff) < 0.35) {
        currentY = target;
      } else {
        currentY += diff * positionLerp;
      }

      applyY(currentY);
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
      const h = rail.getBoundingClientRect().height;
      smoothScroll = scrollEl?.scrollTop ?? 0;
      currentY = centerTop(h);
      applyY(currentY);
      ensureLoop();
    };

    const start = () => {
      if (!mq.matches) {
        active = false;
        clearY();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      active = true;
      smoothScroll = scrollEl?.scrollTop ?? 0;
      currentY = centerTop(rail.getBoundingClientRect().height);
      applyY(currentY);
      ensureLoop();
    };

    const stop = () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearY();
    };

    const onMq = () => (mq.matches ? start() : stop());

    const ro = new ResizeObserver(() => onResize());

    start();
    ro.observe(rail);
    mq.addEventListener("change", onMq);
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      scrollEl?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [railRef, scrollRef]);
}
