/**
 * 계좌 보유 성향(성장주 / 가치·방어주) 분류 정책 — SSOT.
 *
 * 우선순위:
 * 1) 사용자 종목 지정(오버라이드) — 포트폴리오가 바뀌어도 디스크에 유지
 * 2) 시드 티커(앱 기본 추천, 사용자가 덮어쓸 수 있음)
 * 3) 코인 → 성장
 * 4) 항공우주·방산 키워드 → 성장 (GICS Industrials여도)
 * 5) GICS 섹터
 * 6) 업종·종목명 키워드
 * 7) 기본 → 가치·방어
 *
 * 관리: 계좌관리 보유 표에서 종목별 지정. API `/api/user/account-holding-style`.
 */

/** @typedef {"growth" | "value"} AccountHoldingStyle */

export const ACCOUNT_HOLDING_STYLE_POLICY_VERSION = 1;

/** GICS → 성장 */
export const STYLE_GROWTH_GICS = [
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
];

/** GICS → 가치·방어 */
export const STYLE_VALUE_GICS = [
  "Utilities",
  "Consumer Staples",
  "Financials",
  "Energy",
  "Materials",
  "Real Estate",
  "Industrials",
  "Health Care",
];

/**
 * 앱 기본 시드 — 사용자 오버라이드가 없을 때 성장으로 본다.
 * 포트폴리오에 없어도 해롭지 않음(매칭될 때만 적용).
 * @type {Record<string, AccountHoldingStyle>}
 */
export const STYLE_SEED_TICKER_OVERRIDES = {
  GOOGL: "growth",
  GOOG: "growth",
  IQQ: "growth",
  ITA: "growth",
};

/** 성장 키워드(업종·이름·심볼 결합 문자열) */
export const STYLE_GROWTH_KEYWORD_SOURCE =
  "반도체|소프트웨어|인터넷|게임|바이오|2차전지|이차전지|전기차|디스플레이|플랫폼|클라우드|AI|인공지능|로봇|우주|핀테크|구글|alphabet|googl|항공우주|방산|국방|aerospace|defense|IT\\b|tech|software|semiconductor|biotech|internet|cloud|battery|ev\\b|nvidia|tesla|meta|amazon|apple|microsoft|netflix|crypto|bitcoin|이더";

/** 가치·방어 키워드 */
export const STYLE_VALUE_KEYWORD_SOURCE =
  "은행|보험|증권|유틸리티|전력|가스|통신|식품|유통|철강|화학|건설|운송|물류|지주|정유|에너지|담배|필수|배당|utility|bank|insurance|telecom|staple|reit|realty|oil|gas|steel|chemical";

/** 방산·항공우주 — Industrials여도 성장 */
export const STYLE_DEFENSE_GROWTH_SOURCE =
  "항공우주|방산|국방|aerospace|defense";

export const STYLE_GROWTH_GICS_SET = new Set(STYLE_GROWTH_GICS);
export const STYLE_VALUE_GICS_SET = new Set(STYLE_VALUE_GICS);

const STYLE_GROWTH_RE = new RegExp(STYLE_GROWTH_KEYWORD_SOURCE, "i");
const STYLE_VALUE_RE = new RegExp(STYLE_VALUE_KEYWORD_SOURCE, "i");
const STYLE_DEFENSE_RE = new RegExp(STYLE_DEFENSE_GROWTH_SOURCE, "i");

/**
 * @param {string} symbol
 */
export function normalizeAccountStyleTicker(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(KS|KQ|KN|N|O|L|TO)$/i, "");
}

/**
 * @param {unknown} style
 * @returns {style is AccountHoldingStyle}
 */
export function isAccountHoldingStyle(style) {
  return style === "growth" || style === "value";
}

/**
 * @param {{
 *   market?: string;
 *   sectorEn?: string | null;
 *   sectorKo?: string | null;
 *   industry?: string | null;
 *   subIndustry?: string | null;
 *   name?: string | null;
 *   symbol?: string | null;
 * }} row
 * @param {Record<string, AccountHoldingStyle> | null | undefined} [userOverrides]
 * @returns {{ style: AccountHoldingStyle; source: "override" | "seed" | "crypto" | "defense" | "gics" | "keyword" | "default" }}
 */
export function resolveAccountHoldingStyle(row, userOverrides) {
  const ticker = normalizeAccountStyleTicker(row?.symbol ?? "");
  const rawSym = String(row?.symbol ?? "").trim().toUpperCase();

  if (ticker && userOverrides && isAccountHoldingStyle(userOverrides[ticker])) {
    return { style: userOverrides[ticker], source: "override" };
  }
  if (rawSym && userOverrides && isAccountHoldingStyle(userOverrides[rawSym])) {
    return { style: userOverrides[rawSym], source: "override" };
  }

  if (ticker && isAccountHoldingStyle(STYLE_SEED_TICKER_OVERRIDES[ticker])) {
    return { style: STYLE_SEED_TICKER_OVERRIDES[ticker], source: "seed" };
  }

  if (row?.market === "crypto") {
    return { style: "growth", source: "crypto" };
  }

  const blob = [
    row?.sectorKo,
    row?.industry,
    row?.subIndustry,
    row?.name,
    row?.symbol,
  ]
    .filter(Boolean)
    .join(" ");

  if (STYLE_DEFENSE_RE.test(blob)) {
    return { style: "growth", source: "defense" };
  }

  const gics = String(row?.sectorEn ?? "").trim();
  if (gics && STYLE_GROWTH_GICS_SET.has(gics)) {
    return { style: "growth", source: "gics" };
  }
  if (gics && STYLE_VALUE_GICS_SET.has(gics)) {
    return { style: "value", source: "gics" };
  }

  if (STYLE_GROWTH_RE.test(blob)) {
    return { style: "growth", source: "keyword" };
  }
  if (STYLE_VALUE_RE.test(blob)) {
    return { style: "value", source: "keyword" };
  }

  return { style: "value", source: "default" };
}

/**
 * @param {Parameters<typeof resolveAccountHoldingStyle>[0]} row
 * @param {Record<string, AccountHoldingStyle> | null | undefined} [userOverrides]
 * @returns {AccountHoldingStyle}
 */
export function classifyAccountHoldingStyle(row, userOverrides) {
  return resolveAccountHoldingStyle(row, userOverrides).style;
}

/** UI·메일용 요약 */
export function getAccountHoldingStylePolicySummaryKo() {
  return {
    version: ACCOUNT_HOLDING_STYLE_POLICY_VERSION,
    priority: [
      "내 종목 지정(성장/가치) — 포트폴리오 변경 후에도 유지",
      "앱 시드 티커(GOOGL·GOOG·IQQ·ITA 등)",
      "코인 → 성장",
      "항공우주·방산 → 성장",
      "GICS 섹터(IT·통신·임의소비=성장 / 유틸·필수·금융·에너지 등=가치)",
      "업종·종목명 키워드",
      "기본 → 가치·방어",
    ],
    growthGics: STYLE_GROWTH_GICS,
    valueGics: STYLE_VALUE_GICS,
    seedTickers: { ...STYLE_SEED_TICKER_OVERRIDES },
  };
}
