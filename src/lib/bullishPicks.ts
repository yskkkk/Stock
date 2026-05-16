import type { SignalId } from "../constants/signals";
import type { Market, StockPick } from "../types";
import { pickHasSignal } from "./filterPicks";

const STRONG_BULLISH: SignalId[] = ["ma_golden", "ma_align"];

const SIGNAL_REASONS: Record<SignalId, string> = {
  ma_align:
    "단기(20일) 이동평균이 중기(50일) 위에 있어 정배열 상승 추세가 이어지고 있습니다.",
  ma_golden:
    "20일선이 50일선을 최근 상향 돌파(골든크로스)하여 매수 모멘텀이 강화되었습니다.",
  ma20: "주가가 20일 이동평균선 위에 있어 단기 추세가 우호적입니다.",
  rsi: "RSI가 과매수 구간 전에서 상승 중이며, 매수세가 유입되는 구간입니다.",
  volume: "평균 대비 거래량이 증가하여 상승 동력이 뒷받침되고 있습니다.",
};

const SIGNAL_ORDER: SignalId[] = [
  "ma_golden",
  "ma_align",
  "ma20",
  "rsi",
  "volume",
];

function strongSignalCount(pick: StockPick) {
  return STRONG_BULLISH.filter((id) => pickHasSignal(pick, id)).length;
}

export function bullishRankScore(pick: StockPick) {
  let rank = pick.score;
  rank += strongSignalCount(pick) * 1.5;
  if ((pick.changePercent ?? 0) > 0) rank += 1;
  if (pickHasSignal(pick, "rsi")) rank += 0.5;
  return rank;
}

export function isBullishCandidate(pick: StockPick) {
  if (pick.score < 5) return false;
  const strong = strongSignalCount(pick);
  if (pick.score >= 7) return true;
  if (strong >= 2) return true;
  if (strong >= 1 && pick.score >= 6) return true;
  return false;
}

export function buildBullishReasons(pick: StockPick): string[] {
  const reasons: string[] = [];

  if (pick.score >= 7) {
    reasons.push(
      `종합 기술적 점수 ${pick.score}점으로, 스크리너 기준 매수 신호가 매우 강합니다.`,
    );
  } else {
    reasons.push(
      `종합 기술적 점수 ${pick.score}점으로, 매수 후보 기준을 충족했습니다.`,
    );
  }

  const strong = strongSignalCount(pick);
  if (strong >= 2) {
    reasons.push(
      `골든크로스·정배열 등 강한 상승 신호가 ${strong}개 동시에 확인되었습니다.`,
    );
  }

  for (const id of SIGNAL_ORDER) {
    if (pickHasSignal(pick, id)) reasons.push(SIGNAL_REASONS[id]);
  }

  const chg = pick.changePercent;
  if (chg != null && chg > 0) {
    reasons.push(
      `당일 전일 대비 ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% 상승하며 단기 모멘텀이 살아 있습니다.`,
    );
  } else if (chg != null && chg < 0) {
    reasons.push(
      `당일은 ${chg.toFixed(2)}% 조정 중이나, 기술적 지표는 상승 전환·지속 신호를 보입니다.`,
    );
  }

  return reasons;
}

export function enrichBullishPick(pick: StockPick): StockPick {
  return { ...pick, bullishReasons: buildBullishReasons(pick) };
}

function sortBullish(picks: StockPick[]): StockPick[] {
  return picks
    .filter(isBullishCandidate)
    .map(enrichBullishPick)
    .sort((a, b) => {
      const diff = bullishRankScore(b) - bullishRankScore(a);
      if (diff !== 0) return diff;
      return b.score - a.score || (b.changePercent ?? 0) - (a.changePercent ?? 0);
    });
}

export function selectBullishPicks(kr: StockPick[], us: StockPick[]) {
  return sortBullish([...kr, ...us]);
}

export function selectBullishForMarket(
  picks: StockPick[],
  _market: Market,
): StockPick[] {
  return sortBullish(picks);
}
