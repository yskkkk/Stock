export type BubblePointer = {
  clientX: number;
  clientY: number;
};

export function anchorRectFromPointer(pointer: BubblePointer): DOMRect {
  return new DOMRect(pointer.clientX, pointer.clientY, 0, 0);
}

/** 클릭 좌표가 있으면 그 점을 anchor, 없으면 요소 rect */
export function anchorRectForBubble(
  el: HTMLElement,
  pointer?: BubblePointer | null,
): DOMRectReadOnly {
  if (
    pointer != null &&
    Number.isFinite(pointer.clientX) &&
    Number.isFinite(pointer.clientY)
  ) {
    return anchorRectFromPointer(pointer);
  }
  return el.getBoundingClientRect();
}

export function pointerFromElementCenter(el: HTMLElement): BubblePointer {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}
