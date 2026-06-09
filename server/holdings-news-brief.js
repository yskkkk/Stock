/**
 * 보유 종목 뉴스 — 호재/악재 분류·요약 (제목 기반 휴리스틱)
 */
import { analyzeMarketSentiment } from "./sentiment.js";
import { isDisclosureTitle } from "./news-filter.js";

const POS_TERMS = [
  "급등",
  "폭등",
  "실적 호조",
  "어닝 서프라이즈",
  "목표가 상향",
  "수주",
  "계약",
  "승인",
  "신고가",
  "반등",
  "호재",
  "beat",
  "surge",
  "upgrade",
  "record high",
];

const NEG_TERMS = [
  "급락",
  "폭락",
  "실적 쇼크",
  "어닝 쇼크",
  "목표가 하향",
  "거래정지",
  "소송",
  "조사",
  "악재",
  "plunge",
  "crash",
  "downgrade",
  "miss",
  "lawsuit",
];

/**
 * @param {string} title
 */
function matchedTerms(title, terms) {
  const lower = String(title ?? "").toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}

/**
 * @param {number} publishedAt
 */
export function formatNewsPublishedKo(publishedAt) {
  const ms = Number(publishedAt);
  if (!Number.isFinite(ms) || ms <= 0) return "시각 미상";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "시각 미상";
  }
}

/**
 * @param {{
 *   title?: string;
 *   type?: string;
 *   sentiment?: string;
 *   publishedAt?: number;
 *   source?: string;
 * }} item
 * @param {{ symbol?: string; name?: string }} [holding]
 */
export function buildHoldingsNewsBrief(item, holding = {}) {
  const title = String(item?.title ?? "").trim();
  const type = item?.type === "disclosure" ? "disclosure" : "news";
  const sentiment =
    item?.sentiment === "positive" ||
    item?.sentiment === "negative" ||
    item?.sentiment === "neutral"
      ? item.sentiment
      : analyzeMarketSentiment(title, type);

  const labelKo =
    sentiment === "positive" ? "호재" : sentiment === "negative" ? "악재" : "중립";
  const stockName = String(holding?.name ?? holding?.symbol ?? "").trim();
  const prefix = stockName ? `${stockName} — ` : "";

  /** @type {string[]} */
  const parts = [];
  if (type === "disclosure" || isDisclosureTitle(title)) {
    parts.push(`${prefix}공시·공개 정보가 등록되었습니다.`);
  } else if (/속보|breaking|urgent|flash/i.test(title)) {
    parts.push(`${prefix}속보성 헤드라인이 포착되었습니다.`);
  } else {
    parts.push(`${prefix}보유 종목과 관련된 주요 뉴스입니다.`);
  }

  const pos = matchedTerms(title, POS_TERMS);
  const neg = matchedTerms(title, NEG_TERMS);
  if (pos.length) parts.push(`긍정 키워드: ${pos.slice(0, 4).join(", ")}.`);
  if (neg.length) parts.push(`부정 키워드: ${neg.slice(0, 4).join(", ")}.`);

  if (sentiment === "positive") {
    parts.push(
      "제목 기준으로 단기 주가에 우호적으로 해석될 수 있는 요인이 포함되어 있습니다.",
    );
  } else if (sentiment === "negative") {
    parts.push(
      "제목 기준으로 단기 주가에 불리하게 해석될 수 있는 요인이 포함되어 있습니다.",
    );
  } else {
    parts.push("방향성이 뚜렷하지 않으니 아래 원문 링크로 내용을 확인하세요.");
  }

  const source = String(item?.source ?? "").trim();
  if (source) parts.push(`출처: ${source}.`);

  return {
    labelKo,
    sentiment,
    headline: title,
    explanation: parts.join(" "),
    publishedLabel: formatNewsPublishedKo(item?.publishedAt),
  };
}

/**
 * @param {{
 *   title?: string;
 *   type?: string;
 *   sentiment?: string;
 *   publishedAt?: number;
 * }} item
 * @param {number} [now]
 */
export function isBreakingHoldingsNewsItem(item, now = Date.now()) {
  const title = String(item?.title ?? "").trim();
  if (!title) return false;

  const maxAgeMs = (() => {
    const n = Number(process.env.STOCK_HOLDINGS_NEWS_MAX_AGE_MS ?? 7_200_000);
    return Number.isFinite(n) && n >= 300_000 ? Math.min(n, 86_400_000) : 7_200_000;
  })();

  const publishedAt = Number(item?.publishedAt);
  if (!Number.isFinite(publishedAt) || publishedAt <= 0) return false;
  const age = now - publishedAt;
  if (age < 0 || age > maxAgeMs) return false;

  const type = item?.type === "disclosure" ? "disclosure" : "news";
  const sentiment =
    item?.sentiment === "positive" ||
    item?.sentiment === "negative" ||
    item?.sentiment === "neutral"
      ? item.sentiment
      : analyzeMarketSentiment(title, type);

  if (/속보|breaking|urgent|flash/i.test(title)) return true;
  if (type === "disclosure") return true;
  return sentiment === "positive" || sentiment === "negative";
}
