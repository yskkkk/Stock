export type SignalId =
  | "ma_align"
  | "ma_golden"
  | "ma20"
  | "rsi"
  | "volume";

export const FILTER_OPTIONS: { id: SignalId; label: string }[] = [
  { id: "ma_align", label: "이동평균 정배열" },
  { id: "ma_golden", label: "이평선 골든크로스" },
  { id: "ma20", label: "20일선 위" },
  { id: "rsi", label: "RSI" },
  { id: "volume", label: "거래량" },
];
