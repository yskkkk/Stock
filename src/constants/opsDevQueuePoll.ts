/** 개발 대기열 UI — `/api/ops/dev-queue-display` 폴링 (Vite `VITE_OPS_DEV_QUEUE_POLL_MS`, 기본·최소 10s) */
export const OPS_DEV_QUEUE_POLL_MS = (() => {
  const raw = Number(import.meta.env.VITE_OPS_DEV_QUEUE_POLL_MS ?? 10_000);
  const v = Number.isFinite(raw) ? raw : 10_000;
  return Math.min(60_000, Math.max(10_000, v));
})();
