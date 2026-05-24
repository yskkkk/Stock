/**
 * 상단 «개발 대기열» 스트립 표시 — false면 UI·폴링만 끔(코드 유지).
 * 다시 켤 때 true.
 */
export const SHOW_OPS_GLOBAL_DEV_QUEUE_UI = false;

/** 개발 대기열 UI — `/api/ops/dev-queue-display` 폴링 (Vite `VITE_OPS_DEV_QUEUE_POLL_MS`) */
export const OPS_DEV_QUEUE_POLL_MS = (() => {
  const raw = Number(import.meta.env.VITE_OPS_DEV_QUEUE_POLL_MS ?? 250);
  return Number.isFinite(raw) && raw >= 100 ? Math.min(raw, 5000) : 250;
})();
