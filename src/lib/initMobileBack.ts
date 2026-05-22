import { initMobileBackNavigation } from "./mobileBackStack";
import { isNativeApp } from "./isNativeApp";

let started = false;

/** Capacitor 앱 — Android·iOS 시스템 뒤로가기 */
export function ensureMobileBackNavigation() {
  if (!isNativeApp() || started) return;
  started = true;
  initMobileBackNavigation();
}
