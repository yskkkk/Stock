import { initMobileBackNavigation } from "./mobileBackStack";
import { isNativeApp } from "./isNativeApp";

let started = false;

function ensureNativeDocumentClass() {
  if (!isNativeApp() || typeof document === "undefined") return;
  document.documentElement.classList.add("app--capacitor");
}

/** Capacitor 앱 — html 클래스 + Android·iOS 시스템 뒤로가기 */
export function ensureMobileBackNavigation() {
  ensureNativeDocumentClass();
  if (!isNativeApp() || started) return;
  started = true;
  initMobileBackNavigation();
}
