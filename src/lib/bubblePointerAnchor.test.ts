import { describe, expect, it } from "vitest";
import { anchorRectForBubble, anchorRectFromPointer } from "./bubblePointerAnchor";

describe("bubblePointerAnchor", () => {
  it("uses click point as zero-size anchor", () => {
    const rect = anchorRectFromPointer({ clientX: 120, clientY: 340 });
    expect(rect.left).toBe(120);
    expect(rect.right).toBe(120);
    expect(rect.top).toBe(340);
    expect(rect.width).toBe(0);
  });

  it("falls back to element rect without pointer", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      new DOMRect(10, 20, 100, 30) as DOMRect;
    const rect = anchorRectForBubble(el, null);
    expect(rect.left).toBe(10);
    expect(rect.right).toBe(110);
    document.body.removeChild(el);
  });
});
