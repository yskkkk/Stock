import { useEffect, type RefObject } from "react";

const DESKTOP_MQ = "(min-width: 1180px)";
/** 중앙 기준 추가 오프셋 보간 (낮을수록 더 늦게) */
const POSITION_LERP = 0.055;
const SCROLL_SMOOTH = 0.065;
const SCROLL_DRAG = 0.42;
const MAX_DRAG_PX = 110;

/**
 * 데스크톱 왼쪽 레일: CSS top 50% + translate -50% 로 세로 중앙,
 * 스크롤 시 중앙에서 살짝 늦게 따라 움직임.
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
    let currentOffset = 0;
    let smoothScroll = 0;
    let active = false;
    const scrollEl = scrollRef.current;

    const applyOffset = (px: number) => {
      rail.style.setProperty("--app-left-rail-y", `${px}px`);
    };

    const clearOffset = () => {
      rail.style.removeProperty("--app-left-rail-y");
    };

    const tick = () => {
      if (!active || !mq.matches) {
        rafId = 0;
        return;
      }

      const scrollTop = scrollEl?.scrollTop ?? 0;
      smoothScroll += (scrollTop - smoothScroll) * scrollSmooth;

      const drag = Math.max(
        -MAX_DRAG_PX,
        Math.min(MAX_DRAG_PX, (scrollTop - smoothScroll) * scrollDrag),
      );
      const target = drag;
      const diff = target - currentOffset;

      if (Math.abs(diff) < 0.35) {
        currentOffset = target;
      } else {
        currentOffset += diff * positionLerp;
      }

      applyOffset(currentOffset);
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
      smoothScroll = scrollEl?.scrollTop ?? 0;
      currentOffset = 0;
      applyOffset(0);
      ensureLoop();
    };

    const start = () => {
      if (!mq.matches) {
        active = false;
        clearOffset();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        return;
      }
      active = true;
      smoothScroll = scrollEl?.scrollTop ?? 0;
      currentOffset = 0;
      applyOffset(0);
      ensureLoop();
    };

    const stop = () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      clearOffset();
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
