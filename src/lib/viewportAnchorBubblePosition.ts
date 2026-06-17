export const MOBILE_LAYOUT_MAX_WIDTH = 1179;
export const VIEWPORT_PAD = 8;
export const ANCHOR_BUBBLE_GAP = 10;

export type AnchorBubblePlacement = "left" | "right" | "below" | "above";

export type AnchorBubblePosition = {
  left: number;
  top: number;
  placement: AnchorBubblePlacement;
  transform: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function prefersVerticalAnchorBubble(
  viewportWidth = typeof window !== "undefined" ? window.innerWidth : MOBILE_LAYOUT_MAX_WIDTH,
): boolean {
  return viewportWidth <= MOBILE_LAYOUT_MAX_WIDTH;
}

export function positionAnchorBubble(
  anchor: DOMRectReadOnly,
  bubbleW: number,
  bubbleH: number,
  opts?: {
    gap?: number;
    pad?: number;
    forceVertical?: boolean;
  },
): AnchorBubblePosition {
  const gap = opts?.gap ?? ANCHOR_BUBBLE_GAP;
  const pad = opts?.pad ?? VIEWPORT_PAD;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const forceVertical =
    opts?.forceVertical ?? prefersVerticalAnchorBubble(vw);

  if (forceVertical) {
    const fitsBelow = anchor.bottom + gap + bubbleH <= vh - pad;
    const fitsAbove = anchor.top - gap - bubbleH >= pad;
    const below = fitsBelow || (!fitsAbove && anchor.top < vh / 2);
    const left = clamp(
      anchor.left + anchor.width / 2,
      pad + bubbleW / 2,
      vw - pad - bubbleW / 2,
    );
    if (below) {
      return {
        left,
        top: Math.min(anchor.bottom + gap, vh - pad - bubbleH),
        placement: "below",
        transform: "translate(-50%, 0)",
      };
    }
    return {
      left,
      top: Math.max(pad + bubbleH, anchor.top - gap),
      placement: "above",
      transform: "translate(-50%, -100%)",
    };
  }

  const fitsRight = anchor.right + gap + bubbleW <= vw - pad;
  const fitsLeft = anchor.left - gap - bubbleW >= pad;
  const fitsBelow = anchor.bottom + gap + bubbleH <= vh - pad;
  const fitsAbove = anchor.top - gap - bubbleH >= pad;

  if (fitsRight) {
    return {
      left: anchor.right + gap,
      top: clamp(
        anchor.top + anchor.height / 2,
        pad + bubbleH / 2,
        vh - pad - bubbleH / 2,
      ),
      placement: "right",
      transform: "translate(0, -50%)",
    };
  }
  if (fitsLeft) {
    return {
      left: anchor.left - gap,
      top: clamp(
        anchor.top + anchor.height / 2,
        pad + bubbleH / 2,
        vh - pad - bubbleH / 2,
      ),
      placement: "left",
      transform: "translate(-100%, -50%)",
    };
  }
  if (fitsBelow || (!fitsAbove && anchor.top < vh / 2)) {
    const left = clamp(
      anchor.left + anchor.width / 2,
      pad + bubbleW / 2,
      vw - pad - bubbleW / 2,
    );
    return {
      left,
      top: anchor.bottom + gap,
      placement: "below",
      transform: "translate(-50%, 0)",
    };
  }
  const left = clamp(
    anchor.left + anchor.width / 2,
    pad + bubbleW / 2,
    vw - pad - bubbleW / 2,
  );
  return {
    left,
    top: anchor.top - gap,
    placement: "above",
    transform: "translate(-50%, -100%)",
  };
}

export function clampAnchorBubbleInViewport(
  left: number,
  top: number,
  bubbleW: number,
  bubbleH: number,
  transform: string,
  pad = VIEWPORT_PAD,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let x0 = left;
  let y0 = top;
  let x1 = left + bubbleW;
  let y1 = top + bubbleH;

  if (transform === "translate(-50%, 0)") {
    x0 = left - bubbleW / 2;
    x1 = left + bubbleW / 2;
  } else if (transform === "translate(-50%, -100%)") {
    x0 = left - bubbleW / 2;
    x1 = left + bubbleW / 2;
    y0 = top - bubbleH;
    y1 = top;
  } else if (transform === "translate(0, -50%)") {
    y0 = top - bubbleH / 2;
    y1 = top + bubbleH / 2;
    x1 = left + bubbleW;
  } else if (transform === "translate(-100%, -50%)") {
    x0 = left - bubbleW;
    x1 = left;
    y0 = top - bubbleH / 2;
    y1 = top + bubbleH / 2;
  }

  let dx = 0;
  let dy = 0;
  if (x0 < pad) dx = pad - x0;
  else if (x1 > vw - pad) dx = vw - pad - x1;
  if (y0 < pad) dy = pad - y0;
  else if (y1 > vh - pad) dy = vh - pad - y1;

  return { left: left + dx, top: top + dy };
}
