/**
 * 레딧 등에서 자주 언급되는 종목 순위 (ApeWisdom 공개 API).
 * https://apewisdom.io/api/
 */
import { getKoreanStockName, hasHangul, registerKoreanName } from "./names-ko.js";
import { resolveUsKoreanStockNamesBatch } from "./us-naver-korean-name.js";

const APEWISDOM_BASE = "https://apewisdom.io/api/v1.0/filter";
const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

/** 신선 캐시 */
const CACHE_FRESH_MS = 5 * 60 * 1000;
/** 신선도 지나도 즉시 응답 후 백그라운드 갱신 */
const CACHE_STALE_MS = 45 * 60 * 1000;
/** 누락 한글명 보강 예산 (응답 지연 상한) */
const KO_ENRICH_BUDGET_MS = 2_200;
const KO_ENRICH_CONCURRENCY = 8;
const KO_ENRICH_MAX = 40;

/** @type {Map<string, { data: object; at: number }>} */
const cache = new Map();
/** @type {Set<string>} */
const refreshing = new Set();

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
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`ApeWisdom HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @param {Array<{ symbol: string; nameKo?: string | null }>} results
 */
function applyLocalKoreanNames(results) {
  for (const row of results) {
    const ko = getKoreanStockName(row.symbol);
    if (ko && hasHangul(ko)) row.nameKo = ko;
    else if (!row.nameKo) row.nameKo = null;
  }
}

/**
 * @param {Array<{ symbol: string; nameKo?: string | null }>} results
 */
async function enrichMissingKoreanNames(results) {
  applyLocalKoreanNames(results);
  const missing = results
    .filter((r) => !r.nameKo || !hasHangul(r.nameKo))
    .slice(0, KO_ENRICH_MAX)
    .map((r) => r.symbol);
  if (!missing.length) return;

  /** @type {Map<string, string> | null} */
  let batch = null;
  try {
    batch = await Promise.race([
      resolveUsKoreanStockNamesBatch(missing, KO_ENRICH_CONCURRENCY),
      new Promise((resolve) =>
        setTimeout(() => resolve(null), KO_ENRICH_BUDGET_MS),
      ),
    ]);
  } catch {
    batch = null;
  }
  if (!batch) return;

  for (const row of results) {
    if (row.nameKo && hasHangul(row.nameKo)) continue;
    const ko = batch.get(row.symbol);
    if (ko && hasHangul(ko)) {
      row.nameKo = ko;
      registerKoreanName(row.symbol, ko);
    }
  }
}

/**
 * @param {{ filter?: string; page?: number; pages?: number }} [opts]
 */
async function buildRedditMentionsPayload(opts = {}) {
  const filter = ALLOWED.has(String(opts.filter ?? "").trim())
    ? String(opts.filter).trim()
    : "all-stocks";
  const page = Math.max(1, Math.min(20, Number(opts.page) || 1));
  const pageCount = Math.max(1, Math.min(3, Number(opts.pages) || 1));

  /** @type {object[]} */
  const merged = [];
  let totalCount = 0;
  let totalPages = 1;

  const pageNums = [];
  for (let p = page; p < page + pageCount; p++) pageNums.push(p);

  const pagesRaw = await Promise.all(
    pageNums.map((p) => fetchApeWisdomPage(filter, p).catch(() => null)),
  );

  for (const raw of pagesRaw) {
    if (!raw) continue;
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
      const localKo = getKoreanStockName(ticker);
      merged.push({
        rank,
        symbol: ticker,
        name: decodeHtmlEntities(row.name) || ticker,
        nameKo: localKo && hasHangul(localKo) ? localKo : null,
        mentions,
        upvotes: toInt(row.upvotes),
        rank24hAgo: rank24hAgo > 0 ? rank24hAgo : null,
        mentions24hAgo: mentions24hAgo > 0 ? mentions24hAgo : null,
        mentionsDelta: mentions - mentions24hAgo,
        rankDelta: rank24hAgo > 0 ? rank24hAgo - rank : null,
      });
    }
  }

  /** @type {Map<string, object>} */
  const bySym = new Map();
  for (const row of merged) {
    if (!bySym.has(row.symbol)) bySym.set(row.symbol, row);
  }
  const results = [...bySym.values()].sort((a, b) => a.rank - b.rank);

  await enrichMissingKoreanNames(results);

  const now = Date.now();
  return {
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
}

/**
 * @param {string} cacheKey
 * @param {{ filter?: string; page?: number; pages?: number }} opts
 */
function scheduleBackgroundRefresh(cacheKey, opts) {
  if (refreshing.has(cacheKey)) return;
  refreshing.add(cacheKey);
  void buildRedditMentionsPayload(opts)
    .then((data) => {
      cache.set(cacheKey, { data, at: Date.now() });
    })
    .catch(() => {
      /* keep stale */
    })
    .finally(() => {
      refreshing.delete(cacheKey);
    });
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

  if (hit && now - hit.at < CACHE_FRESH_MS) {
    applyLocalKoreanNames(hit.data.results ?? []);
    return hit.data;
  }

  if (hit && now - hit.at < CACHE_STALE_MS) {
    applyLocalKoreanNames(hit.data.results ?? []);
    scheduleBackgroundRefresh(cacheKey, { filter, page, pages: pageCount });
    return hit.data;
  }

  const data = await buildRedditMentionsPayload({
    filter,
    page,
    pages: pageCount,
  });
  cache.set(cacheKey, { data, at: Date.now() });
  return data;
}
