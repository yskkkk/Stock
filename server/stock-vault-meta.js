import { normalizeYahooQuoteSymbol } from "./quote-symbol-resolve.js";
import { yahooGet } from "./yahoo.js";

const CACHE_TTL_MS = 24 * 60 * 60_000;

/** @type {Map<string, { at: number; industry: string | null }>} */
const cache = new Map();

/** @type {Record<string, string>} */
const INDUSTRY_KO = {
  Technology: "기술",
  "Consumer Electronics": "가전·전자",
  "Semiconductor Equipment & Materials": "반도체 장비·소재",
  "Specialty Industrial Machinery": "산업기계",
  "Consulting Services": "컨설팅",
  Industrials: "산업재",
  Healthcare: "헬스케어",
  "Drug Manufacturers—General": "제약",
  "Banks—Regional": "은행",
  "Banks—Diversified": "은행",
  "Insurance—Diversified": "보험",
  "Capital Markets": "증권·자본시장",
  "REIT—Residential": "리츠(주거)",
  "REIT—Office": "리츠(오피스)",
  "REIT—Industrial": "리츠(물류·산업)",
  "REIT—Specialty": "리츠",
  "Utilities—Regulated Electric": "전력",
  "Utilities—Regulated Gas": "가스",
  "Utilities—Renewable": "신재생에너지",
  "Oil & Gas Integrated": "석유·가스",
  "Oil & Gas E&P": "석유·가스 탐사",
  "Auto Manufacturers": "자동차",
  "Internet Content & Information": "인터넷·정보",
  "Software—Infrastructure": "소프트웨어",
  "Software—Application": "소프트웨어",
  "Information Technology Services": "IT 서비스",
  "Electronic Components": "전자부품",
  "Semiconductors": "반도체",
  "Aerospace & Defense": "항공·방산",
  "Building Products & Equipment": "건자재·장비",
  "Specialty Chemicals": "특수화학",
  "Medical Devices": "의료기기",
  "Biotechnology": "바이오",
  "Discount Stores": "할인유통",
  "Home Improvement Retail": "홈리테일",
  "Restaurants": "외식",
  "Entertainment": "엔터테인먼트",
  "Telecom Services": "통신",
  "Real Estate—Development": "부동산 개발",
  "Real Estate Services": "부동산 서비스",
  Financials: "금융",
  "Consumer Cyclical": "경기소비재",
  "Consumer Defensive": "필수소비재",
  Energy: "에너지",
  Materials: "소재",
  Communication: "커뮤니케이션",
};

function hasHangul(text) {
  return /[\uAC00-\uD7A3]/.test(String(text ?? ""));
}

/** @param {string | null | undefined} raw */
function localizeIndustry(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (hasHangul(text)) return text;
  return INDUSTRY_KO[text] ?? text;
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"|null|undefined} market
 */
function cacheKeyFor(symbol, market) {
  return normalizeYahooQuoteSymbol(symbol, market);
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"|null|undefined} market
 */
async function fetchIndustryForSymbol(symbol, market) {
  const key = cacheKeyFor(symbol, market);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.industry;

  try {
    const data = await yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(key)}?modules=assetProfile`,
    );
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
    const industry = localizeIndustry(profile?.industry ?? profile?.sector ?? null);
    cache.set(key, { at: Date.now(), industry });
    return industry;
  } catch {
    cache.set(key, { at: Date.now(), industry: null });
    return null;
  }
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us" }>} items
 * @returns {Promise<Record<string, { industry?: string | null }>>}
 */
export async function fetchStockVaultMetaForItems(items) {
  /** @type {Record<string, { industry?: string | null }>} */
  const meta = {};
  const rows = Array.isArray(items) ? items : [];
  await Promise.all(
    rows.map(async (item) => {
      const sym = String(item?.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!sym) return;
      const industry = await fetchIndustryForSymbol(sym, item.market);
      if (industry) meta[sym] = { industry };
    }),
  );
  return meta;
}
