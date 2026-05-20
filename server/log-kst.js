/** 서버 로그·일별 파일명 — Asia/Seoul(KST) 기준 */

const TZ = "Asia/Seoul";

/**
 * @param {number} [ms]
 * @returns {string} YYYY-MM-DD (KST)
 */
export function kstYmd(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * @param {number} [ms]
 * @returns {string} 예: 2026-05-20 14:32:01.123 KST
 */
export function formatLogTimestampKst(ms = Date.now()) {
  const d = new Date(ms);
  const baseOpts = {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  let frac = "";
  try {
    const fp = new Intl.DateTimeFormat("en-GB", {
      ...baseOpts,
      fractionalSecondDigits: 3,
    }).formatToParts(d);
    const f = fp.find((x) => x.type === "fractionalSecond")?.value;
    if (f != null) frac = `.${f}`;
  } catch {
    /* Node/ICU 미지원 시 초 단위만 */
  }

  const p = new Intl.DateTimeFormat("en-GB", baseOpts).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}${frac} KST`;
}
