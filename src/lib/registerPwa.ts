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

  const run = () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(() => run(), { timeout: 4000 });
  } else {
    window.setTimeout(run, 1500);
  }
}
