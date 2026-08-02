import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const REFRESH_KEY = "ystock:lazy-chunk-force-refresh";

function isChunkLoadError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "");
  return /Failed to fetch dynamically imported module|Loading chunk [\d]+ failed|Importing a module script failed|error loading dynamically imported module/i.test(
    msg,
  );
}

/**
 * Vite 재시작·일시 네트워크 끊김 시 lazy 청크 fetch 실패를 완화.
 * 짧은 재시도 후, 세션당 1회 강제 새로고침.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  opts?: { retries?: number; retryDelayMs?: number },
): LazyExoticComponent<T> {
  const retries = opts?.retries ?? 2;
  const retryDelayMs = opts?.retryDelayMs ?? 400;

  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const mod = await factory();
        try {
          sessionStorage.removeItem(REFRESH_KEY);
        } catch {
          /* ignore */
        }
        return mod;
      } catch (error) {
        lastError = error;
        if (!isChunkLoadError(error) || attempt >= retries) break;
        await new Promise((r) => window.setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }

    if (isChunkLoadError(lastError)) {
      let already = false;
      try {
        already = sessionStorage.getItem(REFRESH_KEY) === "1";
      } catch {
        /* ignore */
      }
      if (!already) {
        try {
          sessionStorage.setItem(REFRESH_KEY, "1");
        } catch {
          /* ignore */
        }
        window.location.reload();
        return new Promise(() => {
          /* reload pending */
        });
      }
    }

    throw lastError;
  });
}

export { isChunkLoadError };
