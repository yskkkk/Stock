export type ChartTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const CHART_TIMEFRAMES: { value: ChartTimeframe; label: string }[] = [
  { value: "1m", label: "1분" },
  { value: "5m", label: "5분" },
  { value: "15m", label: "15분" },
  { value: "1h", label: "1시간" },
  { value: "4h", label: "4시간" },
  { value: "1d", label: "일봉" },
];
