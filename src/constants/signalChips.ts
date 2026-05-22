import type { SignalId } from "./signals";
import { FILTER_OPTIONS } from "./signals";

export interface SignalChipMeta {
  id: SignalId;
  label: string;
  short: string;
  className: string;
}

const SHORT: Record<SignalId, string> = {
  ma_align: "정배열",
  ma_golden: "골든",
  ma20: "20봉",
  ma50: "50선",
  ma5_align: "5·20",
  rsi: "RSI",
  volume: "거래량",
  volume_surge: "급증",
  macd: "MACD",
  high_60: "고가",
  vp_breakout: "매물대",
  bull_bar: "양봉",
};

const CLASS: Record<SignalId, string> = {
  ma_align: "signal-tag signal-tag--align",
  ma_golden: "signal-tag signal-tag--golden",
  ma20: "signal-tag signal-tag--ma20",
  ma50: "signal-tag signal-tag--ma50",
  ma5_align: "signal-tag signal-tag--ma5",
  rsi: "signal-tag signal-tag--rsi",
  volume: "signal-tag signal-tag--volume",
  volume_surge: "signal-tag signal-tag--vol-surge",
  macd: "signal-tag signal-tag--macd",
  high_60: "signal-tag signal-tag--high60",
  vp_breakout: "signal-tag signal-tag--vp",
  bull_bar: "signal-tag signal-tag--bull",
};

export const SIGNAL_CHIPS: SignalChipMeta[] = FILTER_OPTIONS.map((o) => ({
  id: o.id,
  label: o.label,
  short: SHORT[o.id],
  className: CLASS[o.id],
}));

export function resolvePickSignalIds(pick: {
  signalIds?: string[];
  signals: string[];
}): SignalId[] {
  if (pick.signalIds?.length) {
    return pick.signalIds.filter((id): id is SignalId => id in SHORT);
  }
  const ids: SignalId[] = [];
  for (const chip of SIGNAL_CHIPS) {
    if (pick.signals.some((s) => s.includes(chip.short) || s === chip.label)) {
      ids.push(chip.id);
    }
  }
  return ids;
}

export function signalChipMeta(id: SignalId): SignalChipMeta {
  return SIGNAL_CHIPS.find((c) => c.id === id)!;
}
