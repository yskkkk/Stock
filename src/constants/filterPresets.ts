import type { SignalId } from "./signals";

export interface FilterPreset {
  id: string;
  label: string;
  hint: string;
  signalIds: SignalId[];
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: "golden",
    label: "골든크로스",
    hint: "20봉 이평이 50봉 이평을 최근 상향 돌파한 종목만 모읍니다.",
    signalIds: ["ma_golden"],
  },
  {
    id: "trend",
    label: "추세",
    hint: "이동평균 정배열·20봉 위·50일선 위가 함께 맞는 추세 우호 종목입니다.",
    signalIds: ["ma_align", "ma20", "ma50"],
  },
  {
    id: "momentum",
    label: "모멘텀",
    hint: "RSI 상승, 거래량 증가, MACD 상승 중 하나라도 해당하는 모멘텀·수급 조건입니다.",
    signalIds: ["rsi", "volume", "macd"],
  },
  {
    id: "breakout",
    label: "돌파",
    hint: "60일 고가 근접, 매물대 돌파, 거래량 급증 등 돌파·관심 집중 신호 묶음입니다.",
    signalIds: ["high_60", "vp_breakout", "volume_surge"],
  },
  {
    id: "short",
    label: "단기",
    hint: "5·20 단기 정배열과 당일 양봉으로 짧은 기간 탄력을 보는 프리셋입니다.",
    signalIds: ["ma5_align", "bull_bar"],
  },
];

export const FILTER_PRESET_HINTS: Record<string, string> = Object.fromEntries(
  FILTER_PRESETS.map((p) => [p.id, p.hint]),
);
