/**
 * 정규장 여부 (서버 market-hours.js 와 동일 기준).
 * 즉시 매수 UI 비활성화용 — 실주문 강제는 서버.
 */

function localMinutesOfDay(
  market: "kr" | "us",
  now = new Date(),
): { weekday: string; minutes: number } {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: String(parts.weekday ?? ""),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** 국내 09:00–15:30 KST · 미국 09:30–16:00 ET (주말 제외). KR 공휴일은 서버에서 추가 차단. */
export function isMarketRegularOpenClient(
  market: "kr" | "us",
  now = new Date(),
): boolean {
  const { weekday, minutes: mins } = localMinutesOfDay(market, now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (market === "kr") {
    return mins >= 9 * 60 && mins < 15 * 60 + 30;
  }
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function anySelectedMarketRegularOpen(
  markets: Array<"kr" | "us">,
  now = new Date(),
): boolean {
  return markets.some((m) => isMarketRegularOpenClient(m, now));
}
