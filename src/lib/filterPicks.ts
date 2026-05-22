import type { SignalId } from "../constants/signals";
import type { StockPick } from "../types";

const LABEL_TO_ID: Record<SignalId, string> = {
  ma_align: "이동평균 정배열",
  ma_golden: "이평선 골든",
  ma20: "20봉",
  ma50: "50일선",
  ma5_align: "5·20",
  rsi: "RSI",
  volume: "거래량",
  volume_surge: "거래량 급증",
  macd: "MACD",
  high_60: "60일 고가",
  vp_breakout: "매물대",
  bull_bar: "양봉",
};

export type FilterMode = "and" | "or";

export function pickHasSignal(pick: StockPick, id: SignalId): boolean {
  if (pick.signalIds?.length) return pick.signalIds.includes(id);
  const needle = LABEL_TO_ID[id];
  return pick.signals.some((s) => s.includes(needle));
}

export function filterPicksBySignals(
  picks: StockPick[],
  required: SignalId[],
  mode: FilterMode = "and",
): StockPick[] {
  if (required.length === 0) return picks;
  if (mode === "or") {
    return picks.filter((p) => required.some((id) => pickHasSignal(p, id)));
  }
  return picks.filter((p) => required.every((id) => pickHasSignal(p, id)));
}
