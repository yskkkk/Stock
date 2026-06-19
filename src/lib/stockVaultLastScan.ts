import { ko } from "../i18n/ko";
import type {
  GoldenCrossScanState,
  StockVaultScanStatus,
  StockVaultTimeframe,
} from "../types";

export type StockVaultLastScanRow = {
  key: string;
  label: string;
  dailyKr: string | null;
  dailyUs: string | null;
  weeklyKr: string | null;
  weeklyUs: string | null;
  dailyKrAtMs: number | null;
  dailyUsAtMs: number | null;
  weeklyKrAtMs: number | null;
  weeklyUsAtMs: number | null;
};

function findLastScanAtMs(
  state: GoldenCrossScanState,
  market: "kr" | "us",
  timeframe: StockVaultTimeframe,
  scanDate: string | null,
): number | null {
  if (!scanDate) return null;
  const date = scanDate.trim();
  if (!date) return null;
  for (const run of state.lastRuns ?? []) {
    if (run.market !== market) continue;
    const runTf = run.timeframe ?? "1d";
    if (runTf !== timeframe) continue;
    if (run.scanDate?.trim() !== date) continue;
    if (typeof run.atMs === "number" && Number.isFinite(run.atMs) && run.atMs > 0) {
      return run.atMs;
    }
  }
  return null;
}

function rowFromState(
  key: string,
  label: string,
  state: GoldenCrossScanState,
): StockVaultLastScanRow | null {
  const dailyKr = state.krLastScanDate?.trim() || null;
  const dailyUs = state.usLastScanDate?.trim() || null;
  const weeklyKr = state.krWeeklyLastScanDate?.trim() || null;
  const weeklyUs = state.usWeeklyLastScanDate?.trim() || null;
  if (!dailyKr && !dailyUs && !weeklyKr && !weeklyUs) return null;
  return {
    key,
    label,
    dailyKr,
    dailyUs,
    weeklyKr,
    weeklyUs,
    dailyKrAtMs: findLastScanAtMs(state, "kr", "1d", dailyKr),
    dailyUsAtMs: findLastScanAtMs(state, "us", "1d", dailyUs),
    weeklyKrAtMs: findLastScanAtMs(state, "kr", "1wk", weeklyKr),
    weeklyUsAtMs: findLastScanAtMs(state, "us", "1wk", weeklyUs),
  };
}

/** KST 기준 시·분 (마지막 스캔 말풍선) */
export function formatLastScanHmKst(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function buildLastScanRows(
  status: StockVaultScanStatus | null | undefined,
): StockVaultLastScanRow[] | null {
  if (!status) return null;
  const gcState = status.goldenCross?.state ?? status.state;
  const maState = status.maAlign?.state ?? status.state;
  const ma120State = status.ma120Near?.state;
  if (!gcState || !maState) return null;

  const rows = [
    rowFromState("golden_cross", ko.stockVault.lastScanGolden, gcState),
    rowFromState("ma_align", ko.stockVault.lastScanMaAlign, maState),
    ma120State
      ? rowFromState("ma120_near", ko.stockVault.lastScanMa120Near, ma120State)
      : null,
    status.bottomCandle?.state
      ? rowFromState(
          "bottom_candle",
          ko.stockVault.lastScanBottomCandle,
          status.bottomCandle.state,
        )
      : null,
    status.bookAccum?.state
      ? rowFromState(
          "book_accum",
          ko.stockVault.lastScanBookAccum,
          status.bookAccum.state,
        )
      : null,
    status.lowSlopeFlip?.state
      ? rowFromState(
          "low_slope_flip",
          ko.stockVault.lastScanLowSlope,
          status.lowSlopeFlip.state,
        )
      : null,
  ].filter((row): row is StockVaultLastScanRow => row != null);

  return rows.length ? rows : null;
}

/** 표시용 — title에는 전체 날짜·시각(KST) */
export function formatLastScanDateCell(
  iso: string | null | undefined,
  atMs?: number | null,
): {
  label: string;
  title: string | undefined;
  empty: boolean;
} {
  if (!iso) return { label: "—", title: undefined, empty: true };
  const trimmed = iso.trim();
  const hm = formatLastScanHmKst(atMs);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) {
    const dateShort = `${m[2]}-${m[3]}`;
    return {
      label: hm ? `${dateShort} ${hm}` : dateShort,
      title: hm ? `${trimmed} ${hm}` : trimmed,
      empty: false,
    };
  }
  return {
    label: hm ? `${trimmed} ${hm}` : trimmed,
    title: hm ? `${trimmed} ${hm}` : trimmed,
    empty: false,
  };
}
