import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({
  App: { openUrl: vi.fn(() => Promise.resolve()) },
}));

vi.mock("./isNativeApp", () => ({
  isNativeApp: () => false,
}));

vi.mock("./isMobilePhone", () => ({
  isMobilePhoneEnv: () => true,
}));

import { openTradingViewChartUrl } from "./openTradingViewChart";

describe("openTradingViewChartUrl", () => {
  it("parses symbol and interval from chart web url", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openTradingViewChartUrl(
      "https://www.tradingview.com/chart/?symbol=KRX%3A462870&interval=60&utm_source=ystock",
    );
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("symbol=KRX%3A462870"),
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
