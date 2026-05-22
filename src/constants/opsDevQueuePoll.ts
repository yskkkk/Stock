/** 개발 대기열 UI — `/api/ops/dev-queue-display` 폴링 (Vite `VITE_OPS_DEV_QUEUE_POLL_MS`) */
export const OPS_DEV_QUEUE_POLL_MS = (() => {
  const raw = Number(import.meta.env.VITE_OPS_DEV_QUEUE_POLL_MS ?? 250);
  return Number.isFinite(raw) && raw >= 100 ? Math.min(raw, 5000) : 250;
})();
