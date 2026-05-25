import { describe, expect, it } from "vitest";
import {
  clampDockPanelWidthPx,
  defaultDockPanelWidthPx,
  dockPanelOpenSnapThresholdPx,
  dockPanelWidthFromCollapsedDrag,
  isDockPanelWidthPrefUsable,
  minDockPanelWidthPx,
} from "./liveTradeDockPanelWidth";

describe("liveTradeDockPanelWidth", () => {
  const vw = 1440;

  it("defaults near 26rem at desktop width", () => {
    const def = defaultDockPanelWidthPx(vw);
    expect(def).toBeGreaterThanOrEqual(400);
    expect(def).toBeLessThanOrEqual(420);
  });

  it("clamps below minimum to 20rem", () => {
    expect(clampDockPanelWidthPx(80, vw)).toBe(320);
  });

  it("snap threshold is half of minimum panel width", () => {
    const min = minDockPanelWidthPx(vw);
    expect(dockPanelOpenSnapThresholdPx(vw)).toBe(Math.round(min / 2));
  });

  it("collapsed drag uses leftward pull distance not viewport X", () => {
    const startX = 1200;
    expect(dockPanelWidthFromCollapsedDrag(startX, startX, vw)).toBe(0);
    expect(dockPanelWidthFromCollapsedDrag(startX, startX + 80, vw)).toBe(0);
    expect(dockPanelWidthFromCollapsedDrag(startX, startX - 100, vw)).toBe(100);
  });

  it("rejects prefs much narrower than default", () => {
    const def = defaultDockPanelWidthPx(vw);
    expect(isDockPanelWidthPrefUsable(def, vw)).toBe(true);
    expect(isDockPanelWidthPrefUsable(def * 0.5, vw)).toBe(false);
    expect(isDockPanelWidthPrefUsable(224, vw)).toBe(false);
  });
});
