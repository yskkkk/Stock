import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));

function envUrl(): string {
  for (const key of [
    "CAPACITOR_SERVER_URL",
    "VITE_API_BASE_URL",
    "APP_PUBLIC_BASE_URL",
  ]) {
    const v = String(process.env[key] ?? "").trim();
    if (v) return v.replace(/\/+$/, "");
  }
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return "";
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    if (
      key !== "CAPACITOR_SERVER_URL" &&
      key !== "VITE_API_BASE_URL" &&
      key !== "APP_PUBLIC_BASE_URL"
    ) {
      continue;
    }
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val) return val.replace(/\/+$/, "");
  }
  return "";
}

const remoteUrl = envUrl();

const config: CapacitorConfig = {
  appId: "com.stock.dashboard",
  appName: "종목 대시보드",
  webDir: "dist",
  server: remoteUrl
    ? {
        url: remoteUrl,
        cleartext: remoteUrl.startsWith("http://"),
        androidScheme: "https",
        iosScheme: "https",
      }
    : {
        androidScheme: "https",
        iosScheme: "https",
      },
  android: {
    allowMixedContent: true,
  },
  ios: {
    /** Safari/WKWebView 왼쪽 가장자리 스와이프 뒤로가기 */
    allowBackForwardNavigationGestures: true,
  },
};

export default config;
