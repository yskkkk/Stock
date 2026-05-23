import { useEffect, type RefObject } from "react";

const DESKTOP_MQ = "(min-width: 1180px)";
/** 스크롤 위치가 따라잡는 속도 (낮을수록 더 늦게 출발) */
const SCROLL_SMOOTH = 0.038;
/** 목표 오프셋으로 수렴 */
const TARGET_LERP = 0.048;
/** 화면에 실제로 그려지는 오프셋 수렴 (가장 느림 → 제자리 복귀도 부드럽게) */
const POSITION_LERP = 0.036;
const SCROLL_DRAG = 0.38;
const MAX_DRAG_PX = 100;
const SCROLL_DOWN_CAP = 0.085;

/**
 * 데스크톱 왼쪽 레일: 세로 중앙 + 스크롤 후 늦게 따라와 천천히 제자리(중앙)로 복귀.
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
    const scrollSmooth = reduceMotion ? 0.2 : SCROLL_SMOOTH;
    const targetLerp = reduceMotion ? 0.22 : TARGET_LERP;
    const positionLerp = reduceMotion ? 0.26 : POSITION_LERP;
    const scrollDrag = reduceMotion ? 0.2 : SCROLL_DRAG;

    let rafId = 0;
    let currentOffset = 0;
    let targetOffset = 0;
    let smoothScroll = 0;
    let active = false;
    const scrollEl = scrollRef.current;

    const applyOffset = (px: number) => {
      rail.style.setProperty("--app-left-rail-y", `${px}px`);
    };

    const clearOffset = () => {
      rail.style.removeProperty("--app-left-rail-y");
    };

    const clampOffset = (scrollTop: number, smooth: number, offset: number) => {
      const maxDown = Math.min(MAX_DRAG_PX, scrollTop * SCROLL_DOWN_CAP);
      const maxUp = Math.min(MAX_DRAG_PX, Math.max(0, smooth - scrollTop) * SCROLL_DOWN_CAP);
      return Math.max(-maxUp, Math.min(maxDown, offset));
    };

    const tick = () => {
      if (!active || !mq.matches) {
        rafId = 0;
        return;
      }

      const scrollTop = scrollEl?.scrollTop ?? 0;
      smoothScroll += (scrollTop - smoothScroll) * scrollSmooth;

      const rawTarget = clampOffset(
        scrollTop,
        smoothScroll,
        (scrollTop - smoothScroll) * scrollDrag,
      );

      const targetDiff = rawTarget - targetOffset;
      if (Math.abs(targetDiff) < 0.25) {
        targetOffset = rawTarget;
      } else {
        targetOffset += targetDiff * targetLerp;
      }
      targetOffset = clampOffset(scrollTop, smoothScroll, targetOffset);

      const posDiff = targetOffset - currentOffset;
      if (Math.abs(posDiff) < 0.25) {
        currentOffset = targetOffset;
      } else {
        currentOffset += posDiff * positionLerp;
      }
      currentOffset = clampOffset(scrollTop, smoothScroll, currentOffset);

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
      targetOffset = 0;
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
      targetOffset = 0;
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
