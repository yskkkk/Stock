import { isNativeApp } from "./isNativeApp";

/** Capacitor 네이티브 또는 좁은 터치 화면(휴대폰) */
export function isMobilePhoneEnv(): boolean {
  if (isNativeApp()) return true;
  if (typeof window === "undefined") return false;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return narrow && coarse;
}
