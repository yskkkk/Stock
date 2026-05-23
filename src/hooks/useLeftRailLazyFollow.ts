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

function readThemeReserve(column: HTMLElement | null): number {
  if (!column) return readPadTop();
  const theme = column.querySelector<HTMLElement>(".app-theme-corner");
  if (!theme) return readPadTop();
  const h = theme.getBoundingClientRect().height;
  return h > 0 ? h + 10 : readPadTop();
}

/** 스크롤 문서 좌표 — 뷰포트 세로 중앙(테마 아래) */
function idealDocTop(
  scrollTop: number,
  railHeight: number,
  column: HTMLElement | null,
): number {
  const vh = window.innerHeight;
  const padTop = readPadTop();
  const headReserve = scrollTop < 80 ? readThemeReserve(column) : 0;
  return scrollTop + Math.max(padTop + headReserve, (vh - railHeight) / 2);
}

function docTopToColumnTop(
  docTop: number,
  column: HTMLElement,
  scrollEl: HTMLElement,
): number {
  const colRect = column.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  const colTopDoc = scrollEl.scrollTop + (colRect.top - scrollRect.top);
  return docTop - colTopDoc;
}

/**
 * 왼쪽 레일: 좌측 열 안 absolute + 문서 좌표 지연 보간.
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

    const getColumn = () => rail.closest<HTMLElement>(".app__left-column");

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
      const scrollEl = getScrollEl();
      const column = getColumn();
      if (!scrollEl || !column) return;
      const scrollTop = scrollEl.scrollTop;
      const h = rail.getBoundingClientRect().height;
      const ideal = docTopToColumnTop(idealDocTop(scrollTop, h, column), column, scrollEl);
      anchorTop = ideal;
      currentTop = ideal;
      applyTop(currentTop);
    };

    const tick = () => {
      if (!active || !mq.matches) {
        rafId = 0;
        return;
      }

      const scrollEl = getScrollEl();
      const column = getColumn();
      if (!scrollEl || !column) {
        rafId = 0;
        return;
      }

      const scrollTop = scrollEl.scrollTop;
      const h = rail.getBoundingClientRect().height;
      const ideal = docTopToColumnTop(idealDocTop(scrollTop, h, column), column, scrollEl);

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

    const column = getColumn();
    start();
    ro.observe(rail);
    column && ro.observe(column);
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
