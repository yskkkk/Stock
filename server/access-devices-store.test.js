import { describe, expect, it } from "vitest";
import {
  accessDeviceId,
  normalizeDeviceInfoPayload,
  recordAccessDeviceSeen,
  summarizeUserAgent,
} from "./access-devices-store.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(__dirname, ".data", "access-devices.json");

describe("access-devices-store", () => {
  it("summarizes user agents", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
      ),
    ).toMatch(/Windows/);
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/3.4.20 Chrome/142.0.7444.265 Electron/39.8.1 Safari/537.36",
      ),
    ).toMatch(/Cursor/);
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toMatch(/iPhone/);
  });

  it("records device with deviceInfo and stable id", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    const id = accessDeviceId("203.0.113.10", ua);
    const info = normalizeDeviceInfoPayload({
      userAgent: ua,
      platform: "Win32",
      screen: "1920x1080",
      timezone: "Asia/Seoul",
      language: "ko-KR",
    });
    const row = recordAccessDeviceSeen({
      ip: "203.0.113.10",
      userAgent: ua,
      path: "/api/access/device-seen",
      source: "test",
      deviceInfo: info,
      forcePersist: true,
    });
    expect(row?.id).toBe(id);
    expect(row?.deviceLabel).toMatch(/Windows/);
    expect(row?.screen).toBe("1920x1080");
    expect(row?.timezone).toBe("Asia/Seoul");
    expect(fs.existsSync(STORE)).toBe(true);
  });
});
