export type SignalId =
  | "ma_align"
  | "ma_golden"
  | "ma20"
  | "ma50"
  | "ma5_align"
  | "rsi"
  | "volume"
  | "volume_surge"
  | "macd"
  | "high_60"
  | "vp_breakout"
  | "bull_bar";

/** 스크리너·알림 통과: 전체 조건 중 80% 이상 충족 (서버 technical.js 와 동일) */
export const MIN_CONDITION_SATISFY_RATIO = 0.8;

export const FILTER_OPTIONS: { id: SignalId; label: string }[] = [
  { id: "ma_align", label: "이동평균 정배열" },
  { id: "ma_golden", label: "이평선 골든크로스" },
  { id: "ma20", label: "20봉 위" },
  { id: "ma50", label: "50일선 위" },
  { id: "ma5_align", label: "5·20 단기 정배열" },
  { id: "rsi", label: "RSI 상승" },
  { id: "volume", label: "거래량 증가" },
  { id: "volume_surge", label: "거래량 급증" },
  { id: "macd", label: "MACD 상승" },
  { id: "high_60", label: "60일 고가 근접" },
  { id: "vp_breakout", label: "매물대 돌파" },
  { id: "bull_bar", label: "양봉" },
];

export const SIGNAL_CONDITION_TOTAL = FILTER_OPTIONS.length;

export function minConditionsRequired(
  total = SIGNAL_CONDITION_TOTAL,
  ratio = MIN_CONDITION_SATISFY_RATIO,
): number {
  return Math.ceil(total * ratio);
}

export function meetsConditionThreshold(
  metCount: number,
  total = SIGNAL_CONDITION_TOTAL,
  ratio = MIN_CONDITION_SATISFY_RATIO,
): boolean {
  return metCount >= minConditionsRequired(total, ratio);
}
