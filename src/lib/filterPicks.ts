import type { SignalId } from "../constants/signals";
import type { StockPick } from "../types";

const LABEL_TO_ID: Record<SignalId, string> = {
  ma_align: "이동평균 정배열",
  ma_golden: "이평선 골든",
  ma20: "20일선",
  rsi: "RSI",
  volume: "거래량",
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
