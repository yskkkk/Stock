/**
 * AbortSignal.timeout·AbortController abort 등 fetch 취소/타임아웃 판별
 * — void tick·inflight Promise·Playwright route handler unhandledRejection 방지용
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
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "CanceledError"
  ) {
    return true;
  }
  const code =
    typeof err === "object" && err && "code" in err
      ? String(/** @type {{ code?: unknown }} */ (err).code)
      : "";
  if (/^(ERR_CANCELED|UND_ERR_ABORTED|ABORT_ERR)$/i.test(code)) return true;
  const msg = (
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String(/** @type {{ message?: unknown }} */ (err).message)
        : String(err)
  ).toLowerCase();
  if (/^\[?canceled\]?$|^canceled$/.test(msg.trim())) return true;
  if (
    /operation was aborted|this operation was aborted|aborted|timed out|timeout|\[canceled\]/i.test(
      msg,
    )
  ) {
    return true;
  }
  const cause =
    typeof err === "object" && err && "cause" in err
      ? /** @type {{ cause?: unknown }} */ (err).cause
      : undefined;
  return cause != null && cause !== err && isAbortLikeError(cause);
}
