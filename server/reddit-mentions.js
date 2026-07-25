/**
 * 레딧 등에서 자주 언급되는 종목 순위 (ApeWisdom 공개 API).
 * https://apewisdom.io/api/
 */
const APEWISDOM_BASE = "https://apewisdom.io/api/v1.0/filter";
const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

const CACHE_MS = 5 * 60 * 1000;

/** @type {Map<string, { data: object; at: number }>} */
const cache = new Map();

export const REDDIT_MENTION_FILTERS = [
  { id: "all-stocks", labelKo: "전체 주식 서브" },
  { id: "wallstreetbets", labelKo: "r/wallstreetbets" },
  { id: "stocks", labelKo: "r/stocks" },
  { id: "investing", labelKo: "r/investing" },
  { id: "options", labelKo: "r/options" },
  { id: "Daytrading", labelKo: "r/Daytrading" },
];

const ALLOWED = new Set(REDDIT_MENTION_FILTERS.map((f) => f.id));

/**
 * @param {unknown} raw
 */
function decodeHtmlEntities(raw) {
  return String(raw ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * @param {unknown} n
 */
function toInt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * @param {string} filter
 * @param {number} page
 */
async function fetchApeWisdomPage(filter, page) {
  const url = `${APEWISDOM_BASE}/${encodeURIComponent(filter)}/page/${page}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`ApeWisdom HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @param {{ filter?: string; page?: number; pages?: number }} [opts]
 */
export async function fetchRedditMentionsPayload(opts = {}) {
  const filter = ALLOWED.has(String(opts.filter ?? "").trim())
    ? String(opts.filter).trim()
    : "all-stocks";
  const page = Math.max(1, Math.min(20, Number(opts.page) || 1));
  const pageCount = Math.max(1, Math.min(3, Number(opts.pages) || 1));
  const cacheKey = `${filter}:${page}:${pageCount}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_MS) return hit.data;

  /** @type {object[]} */
  const merged = [];
  let totalCount = 0;
  let totalPages = 1;

  for (let p = page; p < page + pageCount; p++) {
    const raw = await fetchApeWisdomPage(filter, p);
    totalCount = toInt(raw?.count) || totalCount;
    totalPages = toInt(raw?.pages) || totalPages;
    const rows = Array.isArray(raw?.results) ? raw.results : [];
    for (const row of rows) {
      const ticker = String(row?.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!ticker || !/^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker)) continue;
      const mentions = toInt(row.mentions);
      const mentions24hAgo = toInt(row.mentions_24h_ago);
      const rank = toInt(row.rank);
      const rank24hAgo = toInt(row.rank_24h_ago);
      merged.push({
        rank,
        symbol: ticker,
        name: decodeHtmlEntities(row.name) || ticker,
        mentions,
        upvotes: toInt(row.upvotes),
        rank24hAgo: rank24hAgo > 0 ? rank24hAgo : null,
        mentions24hAgo: mentions24hAgo > 0 ? mentions24hAgo : null,
        mentionsDelta: mentions - mentions24hAgo,
        rankDelta: rank24hAgo > 0 ? rank24hAgo - rank : null,
      });
    }
    if (p >= totalPages) break;
  }

  // 같은 심볼 중복 제거(페이지 이어붙일 때)
  /** @type {Map<string, object>} */
  const bySym = new Map();
  for (const row of merged) {
    if (!bySym.has(row.symbol)) bySym.set(row.symbol, row);
  }
  const results = [...bySym.values()].sort((a, b) => a.rank - b.rank);

  const data = {
    filter,
    filterLabelKo:
      REDDIT_MENTION_FILTERS.find((f) => f.id === filter)?.labelKo ?? filter,
    page,
    pages: totalPages,
    count: totalCount || results.length,
    results,
    updatedAt: now,
    source: "apewisdom",
    sourceNote:
      "ApeWisdom이 레딧(r/wallstreetbets, r/stocks 등) 게시·댓글에서 티커 언급을 집계한 순위입니다. 투자 조언이 아닙니다.",
    filters: REDDIT_MENTION_FILTERS,
  };
  cache.set(cacheKey, { data, at: now });
  return data;
}
