import { normalizeYahooQuoteSymbol } from "./quote-symbol-resolve.js";
import { getKoreanStockName } from "./names-ko.js";
import {
  normalizeUsTicker,
  resolveUsStockDisplayMetaBatch,
} from "./us-naver-korean-name.js";
import { yahooGet } from "./yahoo.js";
import { fetchKrNaverIndustryRawName } from "./kr-naver-industry.js";
import { readJsonStoreSync, writeJsonStoreSync } from "./store-json.js";

const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_VERSION = 3;
const META_STORE_FILE = "stock-vault-meta-cache.json";
const REFRESH_DEBOUNCE_MS = 2_000;
const META_FETCH_CONCURRENCY = 4;

/** @type {Map<string, { at: number; industry: string | null }>} */
const cache = new Map();

/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;
/** @type {Promise<Record<string, object>> | null} */
let refreshInFlight = null;

/** @param {unknown} raw */
function normalizeMetaStore(raw) {
  const root = raw && typeof raw === "object" ? raw : {};
  /** @type {Record<string, { at?: number; industry?: string | null; nameKo?: string | null; tvSymbol?: string | null; exchange?: string | null }>} */
  const bySymbol =
    root.bySymbol && typeof root.bySymbol === "object"
      ? /** @type {Record<string, object>} */ (root.bySymbol)
      : {};
  return {
    version: CACHE_VERSION,
    updatedAtMs:
      typeof root.updatedAtMs === "number" && Number.isFinite(root.updatedAtMs)
        ? root.updatedAtMs
        : 0,
    bySymbol,
  };
}

function readMetaStoreSync() {
  return readJsonStoreSync(META_STORE_FILE, normalizeMetaStore, () => ({
    version: CACHE_VERSION,
    updatedAtMs: 0,
    bySymbol: {},
  }));
}

/** @param {Record<string, object>} bySymbol */
function persistMetaStore(bySymbol) {
  writeJsonStoreSync(META_STORE_FILE, {
    version: CACHE_VERSION,
    updatedAtMs: Date.now(),
    bySymbol,
  });
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"|null|undefined} market
 */
function readCachedIndustry(symbol, market) {
  const key = cacheKeyFor(symbol, market);
  if (!key || key.endsWith(":")) return "기타";

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.industry ?? "기타";
  }

  const sym = String(symbol ?? "").trim().toUpperCase();
  const row = readMetaStoreSync().bySymbol[sym];
  if (row?.industry) {
    const at =
      typeof row.at === "number" && Number.isFinite(row.at) ? row.at : Date.now();
    cache.set(key, { at, industry: row.industry });
    return row.industry;
  }

  return "기타";
}

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
  [/반도체와반도체|반도체장비|반도체 장비/i, "반도체 장비·소재"],
  [/반도체/i, "반도체"],
  [/화학|석유/i, "화학"],
  [/은행|금융/i, "은행"],
  [/제약|바이오|의약/i, "제약·바이오"],
  [/유통|백화|마트|할인점/i, "유통"],
  [/자동차|완성차|부품/i, "자동차"],
  [/조선|해운/i, "조선"],
  [/철강|금속/i, "철강"],
  [/건설|건자재/i, "건설"],
  [/게임|엔터|미디어/i, "미디어·엔터"],
  [/통신|네트워크/i, "통신"],
  [/2차전지|배터리/i, "2차전지"],
  [/디스플레이|패널/i, "디스플레이"],
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

/** 유사 업종끼리 세로로 붙도록 그룹 순서 고정 */
/** @type {string[][]} */
const STOCK_VAULT_INDUSTRY_GROUPS = [
  [
    "반도체",
    "반도체 장비·소재",
    "2차전지",
    "디스플레이",
    "전자",
    "전자부품",
    "가전·전자",
    "IT 서비스",
    "IT 하드웨어",
    "컴퓨터 하드웨어",
    "소프트웨어",
    "통신장비",
    "인터넷",
    "인터넷·정보",
    "게임·멀티미디어",
    "기술",
  ],
  [
    "은행",
    "보험",
    "생명보험",
    "손해보험",
    "증권·자본시장",
    "자산운용",
    "여신·카드",
    "카드·여신",
    "금융데이터·거래소",
    "모기지 금융",
    "금융",
    "지주사",
    "지주·복합",
    "스펙",
  ],
  [
    "리츠",
    "리츠(주거)",
    "리츠(오피스)",
    "리츠(물류·산업)",
    "리츠(리테일)",
    "리츠(의료)",
    "리츠(모기지)",
    "리츠(호텔)",
    "부동산",
    "부동산 개발",
    "부동산 서비스",
  ],
  [
    "헬스케어",
    "헬스케어 IT",
    "의료기기",
    "의료기기·소모품",
    "의료기관",
    "진단·연구",
    "제약",
    "바이오",
    "제약·바이오",
  ],
  [
    "에너지",
    "석유·가스",
    "석유·가스 탐사",
    "석유·가스 midstream",
    "정유·판매",
    "유정·시추",
    "석유·가스 장비",
    "전력",
    "가스",
    "수도",
    "신재생에너지",
    "발전",
    "유틸리티",
    "전력·유틸리티",
    "태양광",
    "우라늄",
    "석탄",
  ],
  [
    "소재",
    "소재·광업",
    "화학",
    "특수화학",
    "철강",
    "철강·소재",
    "구리",
    "알루미늄",
    "금",
    "귀금속·광업",
    "비철·광업",
    "건축자재",
    "금속 가공",
    "목재",
    "환경·처리",
    "폐기물",
  ],
  [
    "산업재",
    "산업기계",
    "건설·농기계",
    "건설·엔지니어링",
    "건설",
    "주택 건설",
    "건자재·장비",
    "조선",
    "항공·방산",
    "전기장비",
    "과학·측정기기",
    "사무·산업용품",
    "농업 투입재",
  ],
  ["자동차", "자동차 부품", "자동차 딜러", "레저용 차량"],
  [
    "경기소비재",
    "필수소비재",
    "소비재",
    "할인유통",
    "백화점",
    "홈리테일",
    "전문 리테일",
    "의류 유통",
    "식료품 유통",
    "온라인 유통",
    "유통",
    "유통·백화",
    "식품 유통",
    "가공식품",
    "음료",
    "주류",
    "외식",
    "식품·외식",
    "생활·위생용품",
    "가구·가전",
    "명품",
    "신발·잡화",
    "의류",
    "섬유",
    "포장·용기",
    "제지",
    "제과",
    "담배",
    "공구·잡화",
    "개인 서비스",
  ],
  ["운송·물류", "물류", "철도", "항공", "해운", "트럭 운송"],
  [
    "미디어·엔터",
    "엔터테인먼트",
    "방송",
    "출판",
    "광고",
    "도박·게임",
    "리조트·카지노",
    "레저",
    "여행",
    "숙박",
  ],
  ["통신", "통신서비스", "커뮤니케이션"],
  [
    "컨설팅",
    "교육",
    "인력·고용",
    "보안",
    "전문 B2B 서비스",
    "렌탈·리스",
    "농산물",
    "기타",
  ],
];

function collectStockVaultIndustryLabelSet() {
  return new Set([
    ...Object.values(INDUSTRY_KO),
    ...INDUSTRY_KEYWORD_KO.map(([, ko]) => ko),
    ...STOCK_VAULT_INDUSTRY_EXTRA_KO,
    "기타",
  ]);
}

/** 그리드 세로 칸 수 — 가로 3열(국내 수급 업종별과 동일) */
export function stockVaultIndustryGridRows(tabCount) {
  const n = Number(tabCount);
  const cols = 3;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.ceil(n / cols);
}

/** Yahoo·키워드 매핑 기준 전체 업종 탭 — 유사 업종끼리 인접·세로 배치 순 */
export function listStockVaultIndustryTabs() {
  const all = collectStockVaultIndustryLabelSet();
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();

  for (const group of STOCK_VAULT_INDUSTRY_GROUPS) {
    for (const label of group) {
      if (!all.has(label) || seen.has(label)) continue;
      ordered.push(label);
      seen.add(label);
    }
  }

  const rest = [...all]
    .filter((label) => !seen.has(label))
    .sort((a, b) => a.localeCompare(b, "ko"));
  ordered.push(...rest);
  return ordered;
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

  if (INDUSTRY_KO[text]) return INDUSTRY_KO[text];

  for (const [en, ko] of Object.entries(INDUSTRY_KO)) {
    if (normalizeIndustryText(en) === text) return ko;
  }

  for (const [re, ko] of INDUSTRY_KEYWORD_KO) {
    if (re.test(text)) return ko;
  }

  if (hasHangul(text)) return text;

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
  if (!key || key.endsWith(":")) return "기타";

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.industry ?? "기타";
  }

  /** @type {string | null} */
  let industry = null;

  try {
    const ySym = key.slice(key.indexOf(":") + 1);
    const data = await yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(ySym)}?modules=assetProfile`,
    );
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
    industry = localizeIndustry(profile?.industry ?? profile?.sector ?? null);
  } catch {
    industry = null;
  }

  if (!industry && market === "kr") {
    try {
      industry = localizeIndustry(await fetchKrNaverIndustryRawName(symbol));
    } catch {
      industry = null;
    }
  }

  const resolved = industry ?? "기타";
  cache.set(key, { at: Date.now(), industry: resolved });
  return resolved;
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us" }>} items
 * @returns {Promise<Record<string, { industry?: string | null; nameKo?: string | null; tvSymbol?: string | null; exchange?: string | null }>>}
 */
/** @param {{ symbol?: string; market?: "kr"|"us" }} item */
function inferVaultItemMarket(item) {
  if (item.market === "us" || item.market === "kr") return item.market;
  const sym = String(item?.symbol ?? "").trim();
  if (/^\d{6}(\.(KS|KQ))?$/i.test(sym)) return "kr";
  return "us";
}

export function readStockVaultMetaForItemsSync(items) {
  /** @type {Record<string, { industry?: string | null; nameKo?: string | null; tvSymbol?: string | null; exchange?: string | null }>} */
  const meta = {};
  const store = readMetaStoreSync();
  const rows = Array.isArray(items) ? items : [];

  for (const item of rows) {
    const sym = String(item?.symbol ?? "").trim().toUpperCase();
    if (!sym) continue;
    const market = inferVaultItemMarket(item);
    const cached = store.bySymbol[sym];
    const nameKo =
      market === "us"
        ? getKoreanStockName(sym) ?? cached?.nameKo ?? null
        : getKoreanStockName(sym);
    meta[sym] = {
      industry: readCachedIndustry(sym, market),
      ...(nameKo ? { nameKo } : {}),
      ...(cached?.tvSymbol ? { tvSymbol: cached.tvSymbol } : {}),
      ...(cached?.exchange ? { exchange: cached.exchange } : {}),
    };
  }
  return meta;
}

/** @param {Record<string, { industry?: string | null; nameKo?: string | null; tvSymbol?: string | null; exchange?: string | null }>} meta */
function mergeMetaIntoStore(meta) {
  const store = readMetaStoreSync();
  const bySymbol = { ...store.bySymbol };
  const now = Date.now();
  for (const [sym, row] of Object.entries(meta)) {
    bySymbol[sym] = { ...bySymbol[sym], ...row, at: now };
    const market = /^\d{6}(\.(KS|KQ))?$/i.test(sym) ? "kr" : "us";
    if (row.industry) {
      cache.set(cacheKeyFor(sym, market), { at: now, industry: row.industry });
    }
  }
  persistMetaStore(bySymbol);
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us" }>} items
 */
export async function refreshStockVaultMetaForItemsAsync(items) {
  const meta = await fetchStockVaultMetaForItems(items);
  mergeMetaIntoStore(meta);
  return meta;
}

/**
 * @param {Array<{ symbol: string; market?: "kr"|"us" }>} items
 */
export function scheduleStockVaultMetaRefresh(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (refreshInFlight) return;
    refreshInFlight = refreshStockVaultMetaForItemsAsync(rows)
      .catch(() => ({}))
      .finally(() => {
        refreshInFlight = null;
      });
  }, REFRESH_DEBOUNCE_MS);
}

export async function fetchStockVaultMetaForItems(items) {
  /** @type {Record<string, { industry?: string | null; nameKo?: string | null; tvSymbol?: string | null; exchange?: string | null }>} */
  const meta = {};
  const rows = Array.isArray(items) ? items : [];
  const usSymbols = rows
    .filter((it) => inferVaultItemMarket(it) === "us")
    .map((it) => String(it.symbol ?? "").trim().toUpperCase());
  const usMetaMap = await resolveUsStockDisplayMetaBatch(usSymbols);

  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const item = rows[idx];
      const sym = String(item?.symbol ?? "")
        .trim()
        .toUpperCase();
      if (!sym) continue;
      const industry = await fetchIndustryForSymbol(sym, item.market);
      const market = inferVaultItemMarket(item);
      const bare = normalizeUsTicker(sym);
      const usMeta = market === "us" ? usMetaMap.get(bare) : null;
      const nameKo =
        market === "us"
          ? usMeta?.nameKo ?? getKoreanStockName(sym) ?? null
          : getKoreanStockName(sym);
      meta[sym] = {
        industry,
        ...(nameKo ? { nameKo } : {}),
        ...(usMeta?.tvSymbol ? { tvSymbol: usMeta.tvSymbol } : {}),
        ...(usMeta?.exchange ? { exchange: usMeta.exchange } : {}),
      };
    }
  }

  const workers = Math.min(META_FETCH_CONCURRENCY, Math.max(1, rows.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return meta;
}
