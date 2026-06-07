import { normalizeYahooQuoteSymbol } from "./quote-symbol-resolve.js";
import { yahooGet } from "./yahoo.js";

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_VERSION = 2;

/** @type {Map<string, { at: number; industry: string | null }>} */
const cache = new Map();

/** @type {Record<string, string>} */
const INDUSTRY_KO = {
  Technology: "기술",
  "Consumer Electronics": "가전·전자",
  "Semiconductor Equipment & Materials": "반도체 장비·소재",
  "Specialty Industrial Machinery": "산업기계",
  "Farm & Heavy Construction Machinery": "건설·농기계",
  "Consulting Services": "컨설팅",
  Industrials: "산업재",
  Healthcare: "헬스케어",
  "Drug Manufacturers—General": "제약",
  "Drug Manufacturers - General": "제약",
  "Drug Manufacturers—Specialty & Generic": "제약",
  "Drug Manufacturers - Specialty & Generic": "제약",
  "Banks—Regional": "은행",
  "Banks - Regional": "은행",
  "Banks—Diversified": "은행",
  "Banks - Diversified": "은행",
  "Insurance—Diversified": "보험",
  "Insurance - Diversified": "보험",
  "Insurance—Life": "생명보험",
  "Insurance - Life": "생명보험",
  "Insurance—Property & Casualty": "손해보험",
  "Insurance - Property & Casualty": "손해보험",
  "Capital Markets": "증권·자본시장",
  "Asset Management": "자산운용",
  "Credit Services": "여신·카드",
  "Financial Data & Stock Exchanges": "금융데이터·거래소",
  "REIT—Residential": "리츠(주거)",
  "REIT - Residential": "리츠(주거)",
  "REIT—Office": "리츠(오피스)",
  "REIT - Office": "리츠(오피스)",
  "REIT—Industrial": "리츠(물류·산업)",
  "REIT - Industrial": "리츠(물류·산업)",
  "REIT—Retail": "리츠(리테일)",
  "REIT - Retail": "리츠(리테일)",
  "REIT—Healthcare Facilities": "리츠(의료)",
  "REIT - Healthcare Facilities": "리츠(의료)",
  "REIT—Specialty": "리츠",
  "REIT - Specialty": "리츠",
  "REIT—Diversified": "리츠",
  "REIT - Diversified": "리츠",
  "REIT—Mortgage": "리츠(모기지)",
  "REIT - Mortgage": "리츠(모기지)",
  "REIT—Hotel & Motel": "리츠(호텔)",
  "REIT - Hotel & Motel": "리츠(호텔)",
  "Utilities—Regulated Electric": "전력",
  "Utilities - Regulated Electric": "전력",
  "Utilities—Regulated Gas": "가스",
  "Utilities - Regulated Gas": "가스",
  "Utilities—Regulated Water": "수도",
  "Utilities - Regulated Water": "수도",
  "Utilities—Renewable": "신재생에너지",
  "Utilities - Renewable": "신재생에너지",
  "Utilities—Independent Power Producers": "발전",
  "Utilities - Independent Power Producers": "발전",
  "Utilities—Diversified": "유틸리티",
  "Utilities - Diversified": "유틸리티",
  "Oil & Gas Integrated": "석유·가스",
  "Oil & Gas E&P": "석유·가스 탐사",
  "Oil & Gas Midstream": "석유·가스 midstream",
  "Oil & Gas Refining & Marketing": "정유·판매",
  "Oil & Gas Drilling": "유정·시추",
  "Oil & Gas Equipment & Services": "석유·가스 장비",
  "Auto Manufacturers": "자동차",
  "Auto Parts": "자동차 부품",
  "Auto & Truck Dealerships": "자동차 딜러",
  "Recreational Vehicles": "레저용 차량",
  "Internet Content & Information": "인터넷·정보",
  "Internet Retail": "온라인 유통",
  "Software—Infrastructure": "소프트웨어",
  "Software - Infrastructure": "소프트웨어",
  "Software—Application": "소프트웨어",
  "Software - Application": "소프트웨어",
  "Information Technology Services": "IT 서비스",
  "Electronic Components": "전자부품",
  Semiconductors: "반도체",
  "Communication Equipment": "통신장비",
  "Computer Hardware": "컴퓨터 하드웨어",
  "Electronic Gaming & Multimedia": "게임·멀티미디어",
  "Aerospace & Defense": "항공·방산",
  "Building Products & Equipment": "건자재·장비",
  "Engineering & Construction": "건설·엔지니어링",
  "Residential Construction": "주택 건설",
  "Specialty Chemicals": "특수화학",
  "Chemicals": "화학",
  "Agricultural Inputs": "농업 투입재",
  "Medical Devices": "의료기기",
  "Medical Instruments & Supplies": "의료기기·소모품",
  "Medical Care Facilities": "의료기관",
  "Diagnostics & Research": "진단·연구",
  Biotechnology: "바이오",
  "Health Information Services": "헬스케어 IT",
  "Discount Stores": "할인유통",
  "Department Stores": "백화점",
  "Home Improvement Retail": "홈리테일",
  "Specialty Retail": "전문 리테일",
  "Apparel Retail": "의류 유통",
  "Grocery Stores": "식료품 유통",
  "Restaurants": "외식",
  Entertainment: "엔터테인먼트",
  "Resorts & Casinos": "리조트·카지노",
  "Leisure": "레저",
  "Travel Services": "여행",
  "Telecom Services": "통신",
  "Real Estate—Development": "부동산 개발",
  "Real Estate - Development": "부동산 개발",
  "Real Estate Services": "부동산 서비스",
  "Real Estate—Diversified": "부동산",
  "Real Estate - Diversified": "부동산",
  Financials: "금융",
  "Consumer Cyclical": "경기소비재",
  "Consumer Defensive": "필수소비재",
  Energy: "에너지",
  Materials: "소재",
  Communication: "커뮤니케이션",
  "Packaged Foods": "가공식품",
  "Food Distribution": "식품 유통",
  "Beverages—Non-Alcoholic": "음료",
  "Beverages - Non-Alcoholic": "음료",
  "Beverages—Brewers": "주류",
  "Beverages - Brewers": "주류",
  "Household & Personal Products": "생활·위생용품",
  "Personal Services": "개인 서비스",
  "Luxury Goods": "명품",
  "Footwear & Accessories": "신발·잡화",
  "Apparel Manufacturing": "의류",
  "Textile Manufacturing": "섬유",
  "Furnishings, Fixtures & Appliances": "가구·가전",
  "Packaging & Containers": "포장·용기",
  "Paper & Paper Products": "제지",
  "Steel": "철강",
  "Copper": "구리",
  "Aluminum": "알루미늄",
  "Gold": "금",
  "Other Precious Metals & Mining": "귀금속·광업",
  "Industrial Metals & Mining": "비철·광업",
  "Building Materials": "건축자재",
  "Scientific & Technical Instruments": "과학·측정기기",
  "Electrical Equipment & Parts": "전기장비",
  "Pollution & Treatment Controls": "환경·처리",
  "Waste Management": "폐기물",
  "Integrated Freight & Logistics": "물류",
  "Railroads": "철도",
  "Airlines": "항공",
  "Marine Shipping": "해운",
  "Trucking": "트럭 운송",
  "Conglomerates": "지주·복합",
  "Staffing & Employment Services": "인력·고용",
  "Security & Protection Services": "보안",
  "Education & Training Services": "교육",
  "Publishing": "출판",
  "Broadcasting": "방송",
  "Advertising Agencies": "광고",
  "Residential & Commercial REIT": "리츠",
  "Mortgage Finance": "모기지 금융",
  "Shell Companies": "스펙",
  "Farm Products": "농산물",
  "Tobacco": "담배",
  "Confectioners": "제과",
  "Gambling": "도박·게임",
  "Lodging": "숙박",
  "Rental & Leasing Services": "렌탈·리스",
  "Tools & Accessories": "공구·잡화",
  "Solar": "태양광",
  "Uranium": "우라늄",
  "Thermal Coal": "석탄",
  "Lumber & Wood Production": "목재",
  "Metal Fabrication": "금속 가공",
  "Business Equipment & Supplies": "사무·산업용품",
  "Specialty Business Services": "전문 B2B 서비스",
};

/** @type {Array<[RegExp, string]>} */
const INDUSTRY_KEYWORD_KO = [
  [/semiconductor/i, "반도체"],
  [/software/i, "소프트웨어"],
  [/internet/i, "인터넷"],
  [/bank/i, "은행"],
  [/insurance/i, "보험"],
  [/reit/i, "리츠"],
  [/pharma|drug manufacturer/i, "제약"],
  [/biotech/i, "바이오"],
  [/medical|healthcare|health care/i, "헬스케어"],
  [/oil|gas|energy/i, "에너지"],
  [/utility|utilities|electric|power/i, "전력·유틸리티"],
  [/auto|motor/i, "자동차"],
  [/aerospace|defense|aircraft/i, "항공·방산"],
  [/retail|store|department/i, "유통"],
  [/restaurant|food/i, "식품·외식"],
  [/telecom|communication/i, "통신"],
  [/real estate/i, "부동산"],
  [/financial|capital market|asset management|credit/i, "금융"],
  [/chemical/i, "화학"],
  [/steel|metal|mining|copper|aluminum|gold/i, "소재·광업"],
  [/machinery|industrial|manufacturing/i, "산업재"],
  [/construction|engineering|building/i, "건설"],
  [/transport|logistics|shipping|trucking|railroad|airline/i, "운송·물류"],
  [/entertainment|media|broadcast|gaming|casino/i, "미디어·엔터"],
  [/consult/i, "컨설팅"],
  [/electronic/i, "전자"],
  [/computer|hardware/i, "IT 하드웨어"],
  [/solar|renewable|uranium|coal/i, "에너지"],
  [/conglomerate|holding/i, "지주·복합"],
  [/education/i, "교육"],
  [/packaging|paper|textile|apparel|footwear|luxury|household/i, "소비재"],
];

/** @type {string[]} */
const STOCK_VAULT_INDUSTRY_EXTRA_KO = [
  "조선",
  "제약·바이오",
  "2차전지",
  "디스플레이",
  "통신서비스",
  "유통·백화",
  "철강·소재",
  "카드·여신",
  "지주사",
];

/** Yahoo·키워드 매핑 기준 전체 업종 탭 (보관 종목과 무관) */
export function listStockVaultIndustryTabs() {
  const labels = new Set([
    ...Object.values(INDUSTRY_KO),
    ...INDUSTRY_KEYWORD_KO.map(([, ko]) => ko),
    ...STOCK_VAULT_INDUSTRY_EXTRA_KO,
    "기타",
  ]);
  return [...labels].sort((a, b) => a.localeCompare(b, "ko"));
}

function hasHangul(text) {
  return /[\uAC00-\uD7A3]/.test(String(text ?? ""));
}

/** @param {string | null | undefined} raw */
export function normalizeIndustryText(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\u2014/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\s+/g, " ");
}

/** @param {string | null | undefined} raw */
export function localizeIndustry(raw) {
  const text = normalizeIndustryText(raw);
  if (!text) return null;
  if (hasHangul(text)) return text;

  if (INDUSTRY_KO[text]) return INDUSTRY_KO[text];

  for (const [en, ko] of Object.entries(INDUSTRY_KO)) {
    if (normalizeIndustryText(en) === text) return ko;
  }

  for (const [re, ko] of INDUSTRY_KEYWORD_KO) {
    if (re.test(text)) return ko;
  }

  return "기타";
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"|null|undefined} market
 */
function cacheKeyFor(symbol, market) {
  return `${CACHE_VERSION}:${normalizeYahooQuoteSymbol(symbol, market)}`;
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"|null|undefined} market
 */
async function fetchIndustryForSymbol(symbol, market) {
  const key = cacheKeyFor(symbol, market);
  if (!key || key.endsWith(":")) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.industry;

  try {
    const ySym = key.slice(key.indexOf(":") + 1);
    const data = await yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(ySym)}?modules=assetProfile`,
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
