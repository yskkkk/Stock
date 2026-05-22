import { Capacitor } from "@capacitor/core";

/** Capacitor Android·iOS WebView 여부 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
