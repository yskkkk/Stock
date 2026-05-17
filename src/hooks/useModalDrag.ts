import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 모달 카드에 `modalStyle` + 헤더에 `onDragHandlePointerDown`을 붙여 드래그 이동.
 * `resetDeps`가 바뀌면 오프셋을 0으로 초기화한다.
 */
export function useModalDrag(resetDeps: ReadonlyArray<unknown>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, resetDeps);

  const dragRef = useRef<{
    pointerId: number;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);

  const onDragHandlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, select, [data-modal-drag-ignore]")) {
      return;
    }
    e.preventDefault();
    const o = offsetRef.current;
    dragRef.current = {
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      ox: o.x,
      oy: o.y,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      setOffset({
        x: d.ox + ev.clientX - d.sx,
        y: d.oy + ev.clientY - d.sy,
      });
    };
    const up = (ev: PointerEvent) => {
      if (dragRef.current?.pointerId !== ev.pointerId) return;
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  const modalStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px)`,
  } as const;

  return { modalStyle, onDragHandlePointerDown };
}
