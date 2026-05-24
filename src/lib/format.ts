import type { LiveTradeMarket } from "../types";

/** 실매매·시뮬 수량 — 코인은 소수 허용 */
export function formatLiveTradeQuantity(
  value: number,
  market?: LiveTradeMarket,
): string {
  if (!Number.isFinite(value)) return "—";
  if (market === "crypto") {
    const abs = Math.abs(value);
    const digits = abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
    return value.toLocaleString("ko-KR", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    });
  }
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

function isUsdtLikeCurrency(currency?: string): boolean {
  const c = String(currency ?? "").toUpperCase();
  return c === "USDT" || c === "USDC";
}

/** 저가 코인 USDT 표시 — 0.00으로 뭉개지지 않게 자릿수 확장 */
export function usdtPriceFractionDigits(value: number): {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0) {
    return { minimumFractionDigits: 2, maximumFractionDigits: 6 };
  }
  if (abs >= 1000) return { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  if (abs >= 1) return { minimumFractionDigits: 2, maximumFractionDigits: 4 };
  if (abs >= 0.01) return { minimumFractionDigits: 2, maximumFractionDigits: 6 };
  if (abs >= 0.0001) return { minimumFractionDigits: 4, maximumFractionDigits: 8 };
  return { minimumFractionDigits: 6, maximumFractionDigits: 10 };
}

export function formatPrice(value: number | undefined, currency?: string) {
  if (value == null) return "—";
  if (currency === "KRW") {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value)}원`;
  }
  const frac = isUsdtLikeCurrency(currency)
    ? usdtPriceFractionDigits(value)
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (
    new Intl.NumberFormat("ko-KR", frac).format(value) +
    (currency ? ` ${currency}` : "")
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
  const frac = isUsdtLikeCurrency(currency)
    ? usdtPriceFractionDigits(v)
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (
    `${sign}${new Intl.NumberFormat("ko-KR", {
      minimumFractionDigits: frac.minimumFractionDigits,
      maximumFractionDigits: frac.maximumFractionDigits,
    }).format(v)}${currency ? ` ${currency}` : ""}`
  );
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

/** 당일 거래대금 — KRW는 억/조, USD 등은 B/M/K */
export function formatTurnover(value: number | undefined, currency?: string) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (currency === "KRW") {
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)}조`;
    if (value >= 1e8) {
      const eok = value / 1e8;
      return eok >= 100 ? `${Math.round(eok).toLocaleString("ko-KR")}억` : `${eok.toFixed(1)}억`;
    }
    if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString("ko-KR")}만`;
    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }
  const cur = currency?.trim().toUpperCase();
  const prefix = cur === "USD" || !cur ? "$" : "";
  const suffix = cur && cur !== "USD" ? ` ${cur}` : "";
  if (value >= 1e9) return `${prefix}${(value / 1e9).toFixed(2)}B${suffix}`;
  if (value >= 1e6) return `${prefix}${(value / 1e6).toFixed(1)}M${suffix}`;
  if (value >= 1e3) return `${prefix}${(value / 1e3).toFixed(0)}K${suffix}`;
  return `${prefix}${Math.round(value).toLocaleString("en-US")}${suffix}`;
}
