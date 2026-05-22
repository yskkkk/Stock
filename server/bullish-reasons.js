/**
 * 텔레그램·API용 상승 이유 문장 — src/lib/bullishPicks.ts 와 동일 로직.
 */
import {
  MIN_CONDITION_SATISFY_RATIO,
  SIGNAL_CONDITION_TOTAL,
  minConditionsRequired,
  resolvePickWeightedScoreBreakdown,
} from "./technical.js";

/** @type {string[]} */
const STRONG_BULLISH = ["ma_golden", "ma_align"];

/** @type {Record<string, string>} */
const SIGNAL_REASONS = {
  ma_align:
    "단기(20봉) 이동평균이 중기(50봉) 위에 있어 정배열 상승 추세가 이어지고 있습니다.",
  ma_golden:
    "20봉 이평이 50봉 이평을 최근 상향 돌파(골든크로스)하여 매수 모멘텀이 강화되었습니다.",
  ma20: "주가가 20봉 이동평균 위에 있어 단기 추세가 우호적입니다.",
  ma50: "주가가 50일 이동평균 위에 있어 중기 추세도 우호적입니다.",
  ma5_align: "5일·20일 이평이 단기 정배열을 이루어 상승 탄력이 살아 있습니다.",
  rsi: "RSI가 과매수 구간 전에서 상승 중이며, 매수세가 유입되는 구간입니다.",
  volume: "평균 대비 거래량이 증가하여 상승 동력이 뒷받침되고 있습니다.",
  volume_surge: "거래량이 평균 대비 크게 급증해 관심 집중 구간입니다.",
  macd: "MACD가 시그널선 위에서 상승 중이며 모멘텀이 개선되고 있습니다.",
  high_60: "최근 60일 고가 대비 3% 이내로 신고가 돌파·근접 구간입니다.",
  vp_breakout:
    "최근 구간 거래량이 몰린 가격대(매물대) 상단을 종가가 거래량 동반 돌파했습니다.",
  bull_bar: "당일 양봉으로 매수세가 우위에 있습니다.",
};

/** @type {string[]} */
const SIGNAL_ORDER = [
  "ma_golden",
  "ma_align",
  "ma20",
  "ma50",
  "ma5_align",
  "high_60",
  "vp_breakout",
  "macd",
  "rsi",
  "volume",
  "volume_surge",
  "bull_bar",
];

/** @param {{ signalIds?: string[] }} pick @param {string} id */
function pickHasSignal(pick, id) {
  return Array.isArray(pick.signalIds) && pick.signalIds.includes(id);
}

function conditionMetCount(pick) {
  return Array.isArray(pick.signalIds) ? pick.signalIds.length : 0;
}

function strongSignalCount(pick) {
  return STRONG_BULLISH.filter((id) => pickHasSignal(pick, id)).length;
}

/**
 * @param {number} met
 * @param {number} minMet
 */
function buildConditionSummaryLine(met, minMet) {
  const pct = Math.round((met / SIGNAL_CONDITION_TOTAL) * 100);
  const thresholdPct = Math.round(MIN_CONDITION_SATISFY_RATIO * 100);
  if (met >= minMet) {
    return `기술적 조건 ${met}/${SIGNAL_CONDITION_TOTAL}개 충족(${pct}%) — 스크리너 추천 기준(${minMet}개 이상, ${thresholdPct}%+)을 만족합니다.`;
  }
  const shortfall = minMet - met;
  return `기술적 조건 ${met}/${SIGNAL_CONDITION_TOTAL}개만 충족(${pct}%) — 스크리너 자동 추천·텔레그램 알림 기준은 ${minMet}개 이상(${thresholdPct}%+)이라 현재 미달입니다. (${shortfall}개 부족)`;
}

/**
 * @param {{
 *   score: number;
 *   signalIds?: string[];
 *   changePercent?: number | null;
 * }} pick
 * @returns {string[]}
 */
export function buildBullishReasons(pick) {
  const reasons = [];
  const met = conditionMetCount(pick);
  const minMet = minConditionsRequired(
    SIGNAL_CONDITION_TOTAL,
    MIN_CONDITION_SATISFY_RATIO,
  );
  const screenerPass = met >= minMet;

  reasons.push(buildConditionSummaryLine(met, minMet));

  const { score, maxScore, pctLabel } = resolvePickWeightedScoreBreakdown(pick);
  reasons.push(
    `가중 기술 점수는 ${score}점 / ${maxScore}점(모델 만점 대비 ${pctLabel}%)입니다.`,
  );
  if (!screenerPass) {
    reasons.push(
      "아래 항목은 현재 충족된 신호에 대한 설명이며, 전체 조건을 만족했다는 뜻은 아닙니다.",
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
    if (screenerPass) {
      reasons.push(
        `당일은 ${chg.toFixed(2)}% 조정 중이나, 충족한 기술 조건 기준으로는 상승 전환·지속 신호가 함께 보입니다.`,
      );
    } else {
      reasons.push(
        `당일 등락은 ${chg.toFixed(2)}%입니다. 조건 미달 상태에서는 단기 조정과 기술 신호가 함께 나타날 수 있습니다.`,
      );
    }
  }

  return reasons;
}
