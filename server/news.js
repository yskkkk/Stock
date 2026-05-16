import { fetchDartDisclosures } from "./dart.js";
import {
  canonicalNewsUrl,
  dedupeNewsItems,
  isDisclosureTitle,
  isNoiseNewsTitle,
  isStockMovingNewsItem,
  titleDedupeKey,
  urlPathKey,
} from "./news-filter.js";
import { resolveDisplayName } from "./names-ko.js";
import {
  isGenericNewsListingUrl,
  pickRssArticleUrl,
  resolveNewsItemUrls,
} from "./news-url.js";
import { tagNewsSentiment } from "./sentiment.js";
import { translateNewsTitles } from "./translate.js";
import { yahooGet, YAHOO_UA } from "./yahoo.js";

const CACHE_MS = 5 * 60_000;
const MAX_ITEMS = 20;
const cache = new Map();

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function rssField(block, tag) {
  const cdata = block.match(
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`),
  );
  if (cdata) return decodeEntities(cdata[1].trim());
  const plain = block.match(new RegExp(`<${tag}>([^<]+)`));
  return plain ? decodeEntities(plain[1].trim()) : "";
}

function rssSourceUrl(block) {
  const m = block.match(/<source[^>]+url=["']([^"']+)["']/i);
  return m?.[1]?.trim() ?? "";
}

function cleanGoogleTitle(title) {
  return title.replace(/\s*-\s*[^-]+$/, "").trim();
}

function classify(title) {
  return isDisclosureTitle(title) ? "disclosure" : "news";
}

function parseGoogleRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = cleanGoogleTitle(rssField(block, "title"));
    const link = rssField(block, "link");
    const direct = rssSourceUrl(block);
    const url = pickRssArticleUrl({ link, direct });
    const pubRaw = block.match(/<pubDate>([^<]+)/)?.[1]?.trim();
    if (!title || !url || isGenericNewsListingUrl(url)) continue;

    const publishedAt = pubRaw ? new Date(pubRaw).getTime() : 0;
    items.push({
      id: `rss:${url}`,
      title,
      url,
      source: direct ? "Google 뉴스" : "Google 뉴스",
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : 0,
      type: classify(title),
    });
  }
  return items;
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { "User-Agent": YAHOO_UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  return parseGoogleRss(await res.text());
}

async function fetchYahooNews(query) {
  const data = await yahooGet(
    `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=25`,
  );
  return (data.news ?? [])
    .map((n) => {
      const url = String(n.link ?? n.url ?? "").trim();
      if (!url || isGenericNewsListingUrl(url)) return null;
      return {
        id: n.uuid ?? url ?? `yahoo:${n.title}`,
        title: n.title ?? "",
        url,
        source: n.publisher ?? "Yahoo Finance",
        publishedAt: (n.providerPublishTime ?? 0) * 1000,
        type: classify(n.title ?? ""),
      };
    })
    .filter(Boolean);
}

function mergeItems(lists) {
  const seenCanon = new Set();
  const seenPath = new Set();
  const seenTitle = new Set();
  const merged = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item.title || !item.url) continue;
      if (isGenericNewsListingUrl(item.url)) continue;
      const canon = canonicalNewsUrl(item.url);
      const pKey = urlPathKey(item.url);
      const tKey = titleDedupeKey(item.title);
      if (
        !canon ||
        seenCanon.has(canon) ||
        (pKey && seenPath.has(pKey)) ||
        (tKey.length > 0 && seenTitle.has(tKey))
      ) {
        continue;
      }
      seenCanon.add(canon);
      if (pKey) seenPath.add(pKey);
      if (tKey.length > 0) seenTitle.add(tKey);
      merged.push(canon !== item.url ? { ...item, url: canon } : item);
    }
  }
  merged.sort((a, b) => b.publishedAt - a.publishedAt);
  return merged.slice(0, MAX_ITEMS * 2);
}

/** 주가 영향 가능성 위주; 없으면 노이즈만 제외한 완화 목록 */
function filterStockMoving(items) {
  const strict = items.filter(isStockMovingNewsItem);
  if (strict.length > 0) return strict;
  const soft = items.filter((i) => !isNoiseNewsTitle(i.title));
  return soft.length > 0 ? soft : items;
}

/** 종목과 무관한 기사 제거 */
function filterRelevant(items, { koName, code, sym }) {
  const name = koName.trim();
  const nameCompact = name.replace(/\s+/g, "");
  const symBase = sym.replace(/\.(KS|KQ)$/i, "").toUpperCase();

  return items.filter((item) => {
    if (item.source.includes("DART") || item.source.includes("전자공시")) {
      return true;
    }

    const title = item.title;
    const titleCompact = title.replace(/\s+/g, "");

    if (name.length >= 2 && (title.includes(name) || titleCompact.includes(nameCompact))) {
      return true;
    }
    if (code && title.includes(code)) return true;
    if (symBase.length >= 2 && title.toUpperCase().includes(symBase)) return true;

    return false;
  });
}

function buildQuery(symbol, name) {
  const sym = symbol.toUpperCase();
  const isKr = sym.endsWith(".KS") || sym.endsWith(".KQ");
  const koName = resolveDisplayName(sym, name);
  const code = sym.replace(/\.(KS|KQ)$/i, "");

  if (isKr) {
    return { koName, code, sym, yahooQuery: koName, googleQuery: `"${koName}" ${code}` };
  }

  return {
    koName,
    code,
    sym,
    yahooQuery: `${koName} ${sym}`,
    googleQuery: `"${koName}" ${sym} stock`,
  };
}

/**
 * @param {string} symbol
 * @param {string} [name]
 */
export async function loadNews(symbol, name = "") {
  const sym = symbol.toUpperCase();
  const cacheKey = `${sym}:v2`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const ctx = buildQuery(sym, name);
  const displayName = ctx.koName;

  const isKr = sym.endsWith(".KS") || sym.endsWith(".KQ");

  const results = await Promise.allSettled([
    fetchYahooNews(ctx.yahooQuery),
    isKr ? fetchDartDisclosures(sym) : Promise.resolve([]),
    fetchGoogleNews(ctx.googleQuery),
  ]);

  const lists = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  const merged = mergeItems(lists);
  const relevant = filterRelevant(merged, ctx);
  const withUrls = await resolveNewsItemUrls(relevant);
  const deduped = dedupeNewsItems(withUrls);
  const moving = filterStockMoving(deduped);
  const toTranslate = moving.slice(0, MAX_ITEMS);
  const translated = await translateNewsTitles(toTranslate);
  const items = tagNewsSentiment(translated).sort(
    (a, b) => b.publishedAt - a.publishedAt,
  );

  const data = {
    symbol: sym,
    name: displayName,
    items,
    updatedAt: Date.now(),
  };

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
