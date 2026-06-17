/** 모바일·PWA: 백그라운드 복귀 직후 pull-to-refresh 등 전체 reload 오작동 방지 */
const DEFAULT_COOLDOWN_MS = 1_800;

let blockedUntil = 0;

export function armMobileResumeCooldown(ms = DEFAULT_COOLDOWN_MS): void {
  blockedUntil = Date.now() + ms;
}

export function isMobileResumeCooldownActive(): boolean {
  return Date.now() < blockedUntil;
}

/** 앱 부팅 시 1회 등록 — visibility / bfcache 복귀 */
export function installMobileResumeGuard(): () => void {
  if (typeof document === "undefined") return () => undefined;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      blockedUntil = Date.now() + 400;
      return;
    }
    armMobileResumeCooldown();
  };

  const onPageShow = (ev: PageTransitionEvent) => {
    if (ev.persisted) armMobileResumeCooldown(900);
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
  };
}
