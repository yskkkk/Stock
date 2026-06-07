/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import App from "./App";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    fetchConfig: vi.fn().mockResolvedValue({
      telegramNotify: { enabled: false, todaySentCount: 0 },
      adminIpConsole: false,
      accessAdmin: false,
      opsCursorAgentAvailable: false,
    }),
    fetchPicks: vi.fn().mockResolvedValue({
      kr: [],
      us: [],
      crypto: [],
      running: false,
      progress: 0,
      total: 0,
    }),
    fetchAuthMe: vi.fn().mockRejectedValue(new Error("no auth")),
    fetchStockVault: vi.fn().mockRejectedValue(new Error("network fail")),
    fetchGoldenCrossStatus: vi.fn().mockRejectedValue(new Error("network fail")),
  };
});

describe("App mount", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders without crashing on mobile viewport", async () => {
    class RO {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", RO);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, "innerWidth", { writable: true, value: 390 });

    const rejections: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => rejections.push(e.reason);
    window.addEventListener("unhandledrejection", onRejection);

    render(<App />);
    await new Promise((r) => window.setTimeout(r, 120));
    window.removeEventListener("unhandledrejection", onRejection);

    expect(rejections).toEqual([]);
    expect(await screen.findByRole("banner", {}, { timeout: 8000 })).toBeTruthy();
  });
});
