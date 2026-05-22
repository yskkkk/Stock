/**
 * API·정적 페이지 베이스 URL.
 * - 웹·PWA: 상대 경로(동일 origin)
 * - Capacitor: 빌드 시 VITE_API_BASE_URL 또는 원격 server.url 로 자동 연결
 */
import { isNativeApp } from "./isNativeApp";

export const MOBILE_API_BASE_STORAGE_KEY = "stock-mobile-api-base-v1";

const BUNDLED_CAP_HOSTS = new Set(["localhost", "127.0.0.1", ""]);

function trimSlash(s: string) {
  return s.replace(/\/+$/, "");
}

/** @returns {string} '' = same origin */
export function getApiBaseUrl(): string {
  if (typeof import.meta.env.VITE_API_BASE_URL === "string") {
    const env = import.meta.env.VITE_API_BASE_URL.trim();
    if (env) return trimSlash(env);
  }
  if (typeof localStorage === "undefined") return "";
  try {
    const stored = localStorage.getItem(MOBILE_API_BASE_STORAGE_KEY)?.trim() ?? "";
    if (stored) return trimSlash(stored);
  } catch {
    /* ignore */
  }
  return "";
}

export function getWebBaseUrl(): string {
  return getApiBaseUrl();
}

/**
 * @param {string} path `/api/...` or `/access-gate.html`
 */
export function withApiBase(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${p}` : p;
}

/**
 * @param {string} raw 사용자 입력 URL
 * @returns {string} 정규화된 origin 또는 빈 문자열
 */
export function normalizeMobileApiBaseInput(raw: string): string {
  let t = String(raw ?? "").trim();
  if (!t) return "";
  if (!/^https?:\/\//i.test(t)) {
    t = `https://${t}`;
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return trimSlash(`${u.protocol}//${u.host}`);
  } catch {
    return "";
  }
}

export function persistMobileApiBase(raw: string): string {
  const normalized = normalizeMobileApiBaseInput(raw);
  if (typeof localStorage === "undefined") return normalized;
  try {
    if (normalized) {
      localStorage.setItem(MOBILE_API_BASE_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(MOBILE_API_BASE_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  return normalized;
}

/** Capacitor가 server.url 로 실제 Stock 서버를 띄운 경우 — API는 같은 origin */
export function isNativeServingRemoteStockApp(): boolean {
  if (!isNativeApp() || typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return false;
  return !BUNDLED_CAP_HOSTS.has(hostname);
}

function envMobileApiBase(): string {
  const v = import.meta.env.VITE_API_BASE_URL;
  if (typeof v === "string" && v.trim()) return trimSlash(v.trim());
  return "";
}

/**
 * 네이티브 첫 기동 시 저장 없이도 env·현재 origin 으로 API 베이스 확정
 * @returns {string} 확정된 base (없으면 "")
 */
export function ensureMobileApiBase(): string {
  const existing = getApiBaseUrl();
  if (existing) return existing;

  const fromEnv = envMobileApiBase();
  if (fromEnv) {
    persistMobileApiBase(fromEnv);
    return fromEnv;
  }

  if (isNativeServingRemoteStockApp()) {
    const origin = trimSlash(window.location.origin);
    persistMobileApiBase(origin);
    return origin;
  }

  return "";
}

export function hasMobileApiBaseConfigured(): boolean {
  if (Boolean(getApiBaseUrl())) return true;
  if (isNativeServingRemoteStockApp()) return true;
  if (isNativeApp() && Boolean(envMobileApiBase())) return true;
  return false;
}
