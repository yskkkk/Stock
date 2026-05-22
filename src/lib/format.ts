export function formatPrice(value: number | undefined, currency?: string) {
  if (value == null) return "—";
  if (currency === "KRW") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value)}원`;
  }
  return (
    new Intl.NumberFormat("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value) + (currency ? ` ${currency}` : "")
  );
}

export function formatPercent(value: number | undefined) {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** 주당 손익(금액) — 부호 포함 */
export function formatSignedMoney(value: number, currency?: string) {
  const sign = value >= 0 ? "+" : "−";
  const v = Math.abs(value);
  if (currency === "KRW") {
    return `${sign}${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(v)}원`;
  }
  return `${sign}${new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}${currency ? ` ${currency}` : ""}`;
}

export function formatNewsDate(ts: number) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** KST 기준 시·분·초 (일자별 추천 기록 등) */
export function formatTimeMsKst(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatEta(seconds: number | null | undefined) {
  if (seconds == null || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `약 ${m}분 ${s > 0 ? `${s}초 ` : ""}남음`;
  return `약 ${s}초 남음`;
}

/** 재스캔 카운트다운 (m:ss 또는 h:mm:ss) */
export function formatRescanCountdown(seconds: number) {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function resolveNextScanAt(
  picks: {
    nextScanAt?: number | null;
    updatedAt?: number | null;
    scanIntervalMs?: number;
  } | null,
): number | null {
  if (!picks) return null;
  if (picks.nextScanAt != null) return picks.nextScanAt;
  if (picks.updatedAt != null && picks.scanIntervalMs != null && picks.scanIntervalMs > 0) {
    return picks.updatedAt + picks.scanIntervalMs;
  }
  return null;
}

export function formatUpdatedAt(ts: number | null) {
  if (ts == null) return "";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "방금 전";
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return new Date(ts).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** UI 표기용: 국내 Yahoo 접미사 `.KS` / `.KQ` 제거 (예: `001450.KS` → `001450`) */
export function displayStockSymbol(symbol: string): string {
  return symbol.trim().replace(/\.(KS|KQ)$/i, "");
}
