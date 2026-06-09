type StockBootCacheApi = {
  isViteDevBoot?: () => boolean;
  bootTimeoutMs?: () => number;
  cacheHintText?: () => string;
  clearAll?: (opts?: { reload?: boolean; resetPurgeFlag?: boolean }) => Promise<void>;
};

declare global {
  interface Window {
    __stockBootCache?: StockBootCacheApi;
  }
}

/** PWA·구 캐시·서비스워커 제거 후 새로고침 */
export async function clearStockWebCache(opts?: {
  reload?: boolean;
  resetPurgeFlag?: boolean;
}): Promise<void> {
  const api = window.__stockBootCache;
  if (api?.clearAll) {
    await api.clearAll(opts);
    return;
  }
  const tasks: Promise<unknown>[] = [];
  if ("caches" in window) {
    tasks.push(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    );
  }
  if ("serviceWorker" in navigator) {
    tasks.push(
      navigator.serviceWorker.getRegistrations().then((regs) =>
        Promise.all(regs.map((r) => r.unregister())),
      ),
    );
  }
  await Promise.all(tasks);
  if (opts?.resetPurgeFlag) {
    try {
      localStorage.removeItem("stock-pwa-boot-purge-version");
    } catch {
      /* private mode */
    }
  }
  if (opts?.reload !== false) window.location.reload();
}

export function stockCacheHintText(): string {
  return (
    window.__stockBootCache?.cacheHintText?.() ??
    "캐시·네트워크 문제일 수 있습니다. 브라우저에서 이 사이트 데이터를 삭제한 뒤 새로고침해 주세요."
  );
}
