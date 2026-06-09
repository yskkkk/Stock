const SW_RELOAD_KEY = "stock-pwa-sw-reload-v2";

let swReloadDone = false;

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

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "SW_ACTIVATED") return;
    if (swReloadDone) return;
    try {
      if (sessionStorage.getItem(SW_RELOAD_KEY) === "1") {
        swReloadDone = true;
        return;
      }
      sessionStorage.setItem(SW_RELOAD_KEY, "1");
    } catch {
      /* private mode — 메모리 플래그만 */
    }
    swReloadDone = true;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => {
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      void reg.update();
    })
    .catch(() => undefined);
}
