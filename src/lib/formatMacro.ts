export function formatMacroCountdown(msLeft: number): string {
  if (msLeft <= 0) return "00:00:00";
  const totalSec = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) {
    return `${days}일 ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatMacroWhen(at: number, timeZone?: string): string {
  const tz = timeZone?.trim() || "Asia/Seoul";
  return new Date(at).toLocaleString("ko-KR", {
    timeZone: tz,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function macroUrgency(msLeft: number): "live" | "soon" | "normal" {
  if (msLeft <= 0) return "live";
  if (msLeft < 2 * 60 * 60 * 1000) return "soon";
  return "normal";
}

const MACRO_CARD_GRADIENT_MAX_DAYS = 10;
const MS_PER_DAY = 86_400_000;

/**
 * 지표 카드 배경 농도 0~1.
 * 10일 초과: 0(기본). 10일~당일: 하루 가까울수록 +10%(10일=0.1 … 당일=1).
 */
export function macroCardNearness(msLeft: number): number {
  if (msLeft <= 0) return 1;
  const days = Math.floor(msLeft / MS_PER_DAY);
  if (days > MACRO_CARD_GRADIENT_MAX_DAYS) return 0;
  return Math.min(1, (MACRO_CARD_GRADIENT_MAX_DAYS + 1 - days) * 0.1);
}

function calendarDateKeyInTz(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** 상장지 기준 캘린더 일자로 D-day / D-n / D+n */
export function formatSectorEarningsDday(
  atMs: number,
  nowMs: number,
  timeZone: string,
): string {
  const a = calendarDateKeyInTz(atMs, timeZone);
  const b = calendarDateKeyInTz(nowMs, timeZone);
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const t0 = Date.UTC(ya, ma - 1, da);
  const t1 = Date.UTC(yb, mb - 1, db);
  const diffDays = Math.round((t0 - t1) / 86400000);
  if (diffDays > 0) return `D-${diffDays}`;
  if (diffDays === 0) return "D-day";
  return `D+${-diffDays}`;
}

export function formatSectorEarningsWhen(at: number, timeZone: string): string {
  return new Date(at).toLocaleString("ko-KR", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}
