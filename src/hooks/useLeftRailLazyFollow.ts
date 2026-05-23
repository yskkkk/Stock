import { useEffect, type RefObject } from "react";

const DESKTOP_MQ = "(min-width: 1180px)";
const LERP = 0.1;
const SCROLL_LAG = 2.4;
const VELOCITY_DECAY = 0.82;

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
 * 데스크톱 왼쪽 레일: 뷰포트 세로 중앙 + 스크롤 시 살짝 늦게 따라옴.
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
    const lerp = reduceMotion ? 0.35 : LERP;
    let rafId = 0;
    let currentY = 0;
    let scrollVel = 0;
    let lastScrollTop = 0;
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

      scrollVel *= VELOCITY_DECAY;
      const h = rail.getBoundingClientRect().height;
      const lag = Math.max(-48, Math.min(48, scrollVel * SCROLL_LAG));
      const target = centerTop(h) + lag;
      const diff = target - currentY;

      if (Math.abs(diff) < 0.4) {
        currentY = target;
      } else {
        currentY += diff * lerp;
      }

      applyY(currentY);
      rafId = requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (!mq.matches || !active) return;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const onScroll = () => {
      if (!scrollEl) return;
      const st = scrollEl.scrollTop;
      scrollVel += st - lastScrollTop;
      lastScrollTop = st;
      ensureLoop();
    };

    const onResize = () => {
      if (!mq.matches) return;
      const h = rail.getBoundingClientRect().height;
      currentY = centerTop(h);
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
      lastScrollTop = scrollEl?.scrollTop ?? 0;
      scrollVel = 0;
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
