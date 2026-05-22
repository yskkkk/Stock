import type { SignalId } from "./signals";

export interface FilterPreset {
  id: string;
  label: string;
  signalIds: SignalId[];
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "golden", label: "골든크로스", signalIds: ["ma_golden"] },
  { id: "trend", label: "추세", signalIds: ["ma_align", "ma20", "ma50"] },
  { id: "momentum", label: "모멘텀", signalIds: ["rsi", "volume", "macd"] },
  {
    id: "breakout",
    label: "돌파",
    signalIds: ["high_60", "vp_breakout", "volume_surge"],
  },
  { id: "short", label: "단기", signalIds: ["ma5_align", "bull_bar"] },
];
