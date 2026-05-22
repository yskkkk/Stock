/**
 * 모바일 APK·Capacitor — WebView가 열 고정 Stock 서버 URL
 * .env: CAPACITOR_SERVER_URL · APP_PUBLIC_BASE_URL (apk:build 시 필수)
 * 개발용 로컬만: allowLanFallback true
 */
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function trimSlash(s) {
  return s.replace(/\/+$/, "");
}

function readEnvFile() {
  const p = path.join(ROOT, ".env");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function normalizeUrl(raw) {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return trimSlash(`${u.protocol}//${u.host}`);
  } catch {
    return "";
  }
}

function guessLanDevUrl(port = "5173") {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    if (!iface) continue;
    for (const net of iface) {
      if (net.family !== "IPv4" || net.internal) continue;
      return `http://${net.address}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
}

/**
 * @param {{ required?: boolean; allowLanFallback?: boolean }} [opts]
 * @returns {string} origin
 */
export function resolveMobileServerUrl(opts = {}) {
  const { required = false, allowLanFallback = true } = opts;
  const file = readEnvFile();
  const keys = [
    "CAPACITOR_SERVER_URL",
    "APP_PUBLIC_BASE_URL",
    "VITE_API_BASE_URL",
    "PUBLIC_APP_URL",
  ];
  for (const k of keys) {
    const v = normalizeUrl(process.env[k] ?? file[k]);
    if (v) return v;
  }
  if (required || !allowLanFallback) {
    throw new Error(
      "[mobile-app] .env에 고정 URL이 필요합니다.\n" +
        "  CAPACITOR_SERVER_URL=https://브라우저에서-쓰는-Stock-주소\n" +
        "예: .env.mobile.example 참고 후 npm run apk:build",
    );
  }
  return guessLanDevUrl();
}
