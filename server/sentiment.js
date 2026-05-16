/** @typedef {'positive' | 'negative' | 'neutral'} MarketSentiment */

const POS_STRONG = [
  "급등",
  "폭등",
  "사상 최고",
  "사상최고",
  "어닝 서프라이즈",
  "실적 호조",
  "실적호조",
  "목표가 상향",
  "대규모 수주",
  "호재",
  "강세",
  "신고가",
  "어닝 서프라이즈",
  "beat estimates",
  "record high",
  "all-time high",
  "surge",
  "soar",
  "upgrade",
];

const POS_WEAK = [
  "상승",
  "호조",
  "성장",
  "흑자",
  "매수",
  "상향",
  "증가",
  "회복",
  "반등",
  "승인",
  "계약",
  "수주",
  "투자",
  "확대",
  "돌파",
  "개선",
  "긍정",
  "이익 증가",
  "매출 증가",
  "gain",
  "rally",
  "rise",
  "growth",
  "profit",
  "bullish",
  "beat",
  "outperform",
];

const NEG_STRONG = [
  "급락",
  "폭락",
  "어닝 쇼크",
  "실적 쇼크",
  "실적쇼크",
  "목표가 하향",
  "거래정지",
  "상폐",
  "파산",
  "횡령",
  "악재",
  "약세",
  "plunge",
  "crash",
  "bankruptcy",
  "downgrade",
  "miss estimates",
  "earnings miss",
];

const NEG_WEAK = [
  "하락",
  "부진",
  "적자",
  "매도",
  "하향",
  "감소",
  "소송",
  "조사",
  "제재",
  "리콜",
  "경고",
  "우려",
  "리스크",
  "손실",
  "축소",
  "규제",
  "부정",
  "drop",
  "fall",
  "decline",
  "loss",
  "bearish",
  "miss",
  "underperform",
  "warning",
  "lawsuit",
  "investigation",
];

const NEUTRAL_HINT = [
  "전망",
  "분석",
  "리포트",
  "인터뷰",
  "설명",
  "개최",
  "발표 예정",
  "what to know",
  "here's why",
];

function countHits(text, terms, weight) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) score += weight;
  }
  return score;
}

/**
 * @param {string} title
 * @param {'news' | 'disclosure'} [type]
 * @returns {MarketSentiment}
 */
export function analyzeMarketSentiment(title, type = "news") {
  const text = (title ?? "").trim();
  if (!text) return "neutral";

  let pos =
    countHits(text, POS_STRONG, 2) + countHits(text, POS_WEAK, 1);
  let neg =
    countHits(text, NEG_STRONG, 2) + countHits(text, NEG_WEAK, 1);

  if (type === "disclosure") {
    if (/실적|매출|영업이익|순이익/.test(text)) {
      if (/호조|증가|개선|흑자|상회/.test(text)) pos += 1;
      if (/부진|감소|적자|하회|쇼크/.test(text)) neg += 1;
    }
  }

  const neutralHint = countHits(text, NEUTRAL_HINT, 1);
  if (neutralHint > 0 && pos === 0 && neg === 0) return "neutral";

  const diff = pos - neg;
  if (diff >= 2) return "positive";
  if (diff <= -2) return "negative";
  if (diff === 1) return "positive";
  if (diff === -1) return "negative";
  return "neutral";
}

/**
 * @param {Array<{ title: string, type?: string, [key: string]: unknown }>} items
 */
export function tagNewsSentiment(items) {
  return items.map((item) => ({
    ...item,
    sentiment: analyzeMarketSentiment(
      item.title,
      item.type === "disclosure" ? "disclosure" : "news",
    ),
  }));
}
