/**
 * AbortSignal.timeout·AbortController abort 등 fetch 취소/타임아웃 판별
 * — void tick·inflight Promise에서 unhandledRejection 방지용
 */

/**
 * @param {unknown} err
 */
export function isAbortLikeError(err) {
  if (!err) return false;
  const name =
    err instanceof Error
      ? err.name
      : typeof err === "object" && err && "name" in err
        ? String(/** @type {{ name?: unknown }} */ (err).name)
        : "";
  if (name === "TimeoutError" || name === "AbortError") return true;
  const msg = (
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String(/** @type {{ message?: unknown }} */ (err).message)
        : String(err)
  ).toLowerCase();
  return /operation was aborted|this operation was aborted|aborted|timed out|timeout/.test(
    msg,
  );
}
