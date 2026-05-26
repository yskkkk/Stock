/** KST 일봉·박스 leftTime/rightTime — candle-utils 와 동일 */
export const KST_OFFSET_SEC = 9 * 60 * 60;

/**
 * @param {unknown} t — unix 초 또는 { year, month, day }
 * @returns {number | null}
 */
export function normalizeBoxUnixTime(t) {
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (t && typeof t === "object" && "year" in t) {
    const o = /** @type {{ year: number; month: number; day: number }} */ (t);
    return (
      Math.floor(Date.UTC(o.year, o.month - 1, o.day) / 1000) - KST_OFFSET_SEC
    );
  }
  return null;
}

/**
 * @param {{ leftTime?: unknown; rightTime?: unknown } & Record<string, unknown>} box
 */
export function withNormalizedBoxTimes(box) {
  const leftTime = normalizeBoxUnixTime(box.leftTime);
  const rightTime = normalizeBoxUnixTime(box.rightTime);
  if (leftTime == null || rightTime == null) return null;
  return { ...box, leftTime, rightTime };
}
