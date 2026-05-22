/**
 * 공개 HTTPS origin (텔레그램·iOS OTA·APK WebView 고정 URL)
 * IP·http 는 iOS 기업/개발 OTA에 사용할 수 없음(유효한 인증서 + 도메인 필요).
 */

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^\[?[0-9a-f:]+]?$/i;

/** @param {string} host */
export function isIpHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost") return true;
  if (IPV4_RE.test(h)) return true;
  if (h.includes(":")) return true;
  return IPV6_RE.test(h);
}

/**
 * @param {string} raw
 * @returns {string | null} https://host origin
 */
export function normalizeHttpsOrigin(raw) {
  let t = String(raw ?? "").trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return null;
    return u.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * @returns {string | null}
 */
export function resolvePublicHttpsOrigin() {
  const keys = [
    "APP_PUBLIC_BASE_URL",
    "CAPACITOR_SERVER_URL",
    "PUBLIC_APP_URL",
  ];
  for (const k of keys) {
    const v = normalizeHttpsOrigin(process.env[k]);
    if (v) return v;
  }
  return null;
}

/**
 * @param {string | null | undefined} origin
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateIosOtaHttpsOrigin(origin) {
  if (!origin) {
    return {
      ok: false,
      reason: "no_https_origin",
    };
  }
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") {
      return { ok: false, reason: "not_https" };
    }
    if (isIpHost(u.hostname) && process.env.STOCK_IOS_OTA_ALLOW_IP !== "1") {
      return { ok: false, reason: "ip_host" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid_origin" };
  }
}
