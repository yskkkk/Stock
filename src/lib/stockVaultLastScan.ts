import { ko } from "../i18n/ko";
import type { GoldenCrossScanState, StockVaultScanStatus } from "../types";

export type StockVaultLastScanRow = {
  key: string;
  label: string;
  dailyKr: string | null;
  dailyUs: string | null;
  weeklyKr: string | null;
  weeklyUs: string | null;
};

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
  return { key, label, dailyKr, dailyUs, weeklyKr, weeklyUs };
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
  ].filter((row): row is StockVaultLastScanRow => row != null);

  return rows.length ? rows : null;
}

/** 표시용 — title에는 전체 날짜 */
export function formatLastScanDateCell(iso: string | null | undefined): {
  label: string;
  title: string | undefined;
  empty: boolean;
} {
  if (!iso) return { label: "—", title: undefined, empty: true };
  const trimmed = iso.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) {
    return {
      label: `${m[2]}-${m[3]}`,
      title: trimmed,
      empty: false,
    };
  }
  return { label: trimmed, title: trimmed, empty: false };
}
