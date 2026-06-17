/** PWA service worker — iOS·Android 홈 화면 설치 */
export function registerPwaServiceWorker(): void {
  if (import.meta.env.DEV) {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((r) => r.unregister())),
      );
    }
    return;
  }
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
