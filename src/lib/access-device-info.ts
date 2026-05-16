/** 접근 신청 시 서버로 보낼 기기·환경 스냅샷 */
export function collectAccessDeviceInfo() {
  if (typeof window === "undefined") return null;
  const nav = navigator;
  const scr = window.screen;
  const dm = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    languages: Array.isArray(nav.languages)
      ? nav.languages.slice(0, 24).join(", ")
      : nav.language,
    screen: scr ? `${scr.width}x${scr.height}` : "",
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemory: typeof dm === "number" ? dm : null,
    maxTouchPoints:
      typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : null,
    cookieEnabled: nav.cookieEnabled,
  };
}
