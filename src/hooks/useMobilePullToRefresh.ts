import { useLayoutEffect, useRef, type RefObject } from "react";

const MQ = "(max-width: 900px)";
const THRESHOLD_PX = 96;
const RUBBER = 0.35;

function isTouchNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  /** dev(Vite)는 저장 시 이미 HMR/전체 reload — 당김 새로고침과 이중으로 느껴짐 */
  if (import.meta.env.DEV) return false;
  if (!window.matchMedia(MQ).matches) return false;
  return navigator.maxTouchPoints > 0;
}

function visibleAriaModalOpen(): boolean {
  const nodes = document.querySelectorAll('[aria-modal="true"]');
  for (const n of nodes) {
    if (!(n instanceof HTMLElement)) continue;
    const r = n.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) return true;
  }
  return false;
}

/**
 * `container` 바깥까지 올라가며, 스크롤 가능하고 세로로 넘치는 조상 중 `scrollTop > edge` 인 것이 있으면 true.
 * 본문 최상단이 아닌 내부 목록·패널을 스크롤 중일 때 당김 새로고침과 충돌하지 않도록.
 */
function innerScrollOccupied(
  target: EventTarget | null,
  container: HTMLElement,
  edge = 2,
): boolean {
  if (!(target instanceof Element)) return false;
  let n: Element | null = target;
  while (n && n !== container) {
    if (n instanceof HTMLElement) {
      const cs = getComputedStyle(n);
      const oy = cs.overflowY;
      if (
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        n.scrollHeight > n.clientHeight + 2 &&
        n.scrollTop > edge
      ) {
        return true;
      }
    }
    n = n.parentElement;
  }
  return false;
}

export interface PullToRefreshLabels {
  pullHint: string;
  releaseHint: string;
}

/**
 * 모바일(900px 이하 + 터치)에서 본문 스크롤 루트가 맨 위일 때 아래로 당기면 `location.reload()`.
 * `indicatorRef`를 붙인 요소에 당김 진행을 표시한다.
 */
export function useMobilePullToRefresh(
  scrollRootRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLDivElement | null>,
  labels: PullToRefreshLabels,
): void {
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const armedRef = useRef(false);
  const startYRef = useRef(0);
  const lastPullRef = useRef(0);

  useLayoutEffect(() => {
    const scrollEl = scrollRootRef.current;
    if (!scrollEl) return;

    const resetIndicator = () => {
      const ind = indicatorRef.current;
      if (!ind) return;
      ind.textContent = "";
      ind.style.opacity = "0";
      ind.style.transform = "translateX(-50%) translateY(-52px)";
      lastPullRef.current = 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!isTouchNarrowViewport()) return;
      if (visibleAriaModalOpen()) {
        resetIndicator();
        return;
      }
      if (e.touches.length !== 1) return;
      if (scrollEl.scrollTop > 2) {
        resetIndicator();
        return;
      }
      if (innerScrollOccupied(e.target, scrollEl)) {
        resetIndicator();
        return;
      }
      armedRef.current = true;
      startYRef.current = e.touches[0].clientY;
      lastPullRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armedRef.current) return;
      if (!isTouchNarrowViewport()) return;
      if (visibleAriaModalOpen()) {
        armedRef.current = false;
        resetIndicator();
        return;
      }
      if (e.touches.length !== 1) return;
      if (innerScrollOccupied(e.target, scrollEl)) {
        armedRef.current = false;
        resetIndicator();
        return;
      }
      if (scrollEl.scrollTop > 2) {
        armedRef.current = false;
        resetIndicator();
        return;
      }

      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 4) return;

      const pull = Math.min(130, dy * RUBBER);
      lastPullRef.current = pull;
      e.preventDefault();

      const ind = indicatorRef.current;
      if (!ind) return;
      const progress = Math.min(1, pull / THRESHOLD_PX);
      ind.style.opacity = String(0.2 + progress * 0.75);
      const ty = Math.max(-44, Math.min(14, pull * 0.22 - 48));
      ind.style.transform = `translateX(-50%) translateY(${ty}px)`;
      ind.textContent =
        pull >= THRESHOLD_PX
          ? labelsRef.current.releaseHint
          : labelsRef.current.pullHint;
    };

    const finish = () => {
      if (!armedRef.current) return;
      armedRef.current = false;
      const pull = lastPullRef.current;
      resetIndicator();
      if (pull >= THRESHOLD_PX) {
        window.location.reload();
      }
    };

    scrollEl.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollEl.addEventListener("touchmove", onTouchMove, { passive: false });
    scrollEl.addEventListener("touchend", finish);
    scrollEl.addEventListener("touchcancel", finish);

    return () => {
      scrollEl.removeEventListener("touchstart", onTouchStart);
      scrollEl.removeEventListener("touchmove", onTouchMove);
      scrollEl.removeEventListener("touchend", finish);
      scrollEl.removeEventListener("touchcancel", finish);
    };
  }, [scrollRootRef, indicatorRef]);
}
