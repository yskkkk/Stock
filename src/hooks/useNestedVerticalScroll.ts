import { useEffect, type RefObject } from "react";

const EPS = 2;

function wheelDeltaY(e: WheelEvent, el: HTMLElement): number {
  let dy = e.deltaY;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 16;
  else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= el.clientHeight * 0.9;
  return dy;
}

function canScrollY(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + EPS;
}

function findParentScrollY(el: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = el.parentElement;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      n.scrollHeight > n.clientHeight + EPS
    ) {
      return n;
    }
    n = n.parentElement;
  }
  const appScroll = document.querySelector<HTMLElement>(".app__scroll");
  if (appScroll && canScrollY(appScroll)) return appScroll;
  return null;
}

/** 좁은 중첩 스크롤 영역 — 휠·드래그 인식 보강 */
export function useNestedVerticalScroll(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  draggingClass = "scroll-region--dragging",
) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!canScrollY(el)) return;

      const dy = wheelDeltaY(e, el);
      const max = el.scrollHeight - el.clientHeight;
      const st = el.scrollTop;
      const atStart = st <= EPS;
      const atEnd = st >= max - EPS;

      if ((!atStart && dy < 0) || (!atEnd && dy > 0)) {
        e.preventDefault();
        e.stopPropagation();
        el.scrollTop = Math.min(max, Math.max(0, st + dy));
        return;
      }

      if ((atStart && dy < 0) || (atEnd && dy > 0)) {
        const parent = findParentScrollY(el);
        if (parent) {
          e.preventDefault();
          e.stopPropagation();
          const pMax = parent.scrollHeight - parent.clientHeight;
          parent.scrollTop = Math.min(pMax, Math.max(0, parent.scrollTop + dy));
        }
      }
    };

    let dragStartY = 0;
    let dragStartScroll = 0;
    let dragging = false;
    let activePointer: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !canScrollY(el)) return;
      dragging = true;
      activePointer = e.pointerId;
      dragStartY = e.clientY;
      dragStartScroll = el.scrollTop;
      el.setPointerCapture(e.pointerId);
      el.classList.add(draggingClass);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== activePointer) return;
      el.scrollTop = dragStartScroll - (e.clientY - dragStartY);
    };

    const endDrag = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== activePointer) return;
      dragging = false;
      activePointer = null;
      el.classList.remove(draggingClass);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.classList.remove(draggingClass);
    };
  }, [draggingClass, enabled, ref]);
}
