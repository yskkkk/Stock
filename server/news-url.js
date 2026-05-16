import { decodeGoogleNewsUrl, isGoogleNewsArticleUrl } from "./google-news-url.js";

const RESOLVE_LIMIT = 10;

const GENERIC_PATH_RE =
  /^\/(?:news\/?|rss\/?|search\/?|home\/?|finance\/?|quote\/[^/]+\/news\/?)?$/i;

const LISTING_HOST_RE =
  /^(?:www\.)?(?:news\.google\.com|finance\.yahoo\.com)$/i;

/**
 * @param {string} url
 */
export function isGenericNewsListingUrl(url) {
  if (!url?.trim()) return true;
  try {
    const u = new URL(url);
    if (isGoogleNewsArticleUrl(url)) return false;
    if (/news\.google\.com\/rss\/search/i.test(url)) return true;
    if (/finance\.yahoo\.com\/quote\/[^/]+\/news\/?$/i.test(url)) return true;
    if (LISTING_HOST_RE.test(u.hostname) && GENERIC_PATH_RE.test(u.pathname)) {
      return true;
    }
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === "/" || path === "") return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Google RSS: `<source url>` is often publisher home — prefer article link.
 * @param {{ link?: string, direct?: string }} opts
 */
export function pickRssArticleUrl({ link = "", direct = "" }) {
  const linkTrim = link.trim();
  const directTrim = direct.trim();

  if (linkTrim && isGoogleNewsArticleUrl(linkTrim)) return linkTrim;
  if (directTrim && !isGenericNewsListingUrl(directTrim)) return directTrim;
  if (linkTrim && !isGenericNewsListingUrl(linkTrim)) return linkTrim;
  return linkTrim || directTrim;
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function resolveArticleUrl(url) {
  if (!url?.trim()) return url;
  if (isGoogleNewsArticleUrl(url)) {
    try {
      const decoded = await decodeGoogleNewsUrl(url);
      if (decoded && !isGenericNewsListingUrl(decoded)) return decoded;
    } catch {
      /* keep original */
    }
  }
  return url;
}

/**
 * @param {Array<{ url: string }>} items
 */
export async function resolveNewsItemUrls(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let url = item.url;
    if (i < RESOLVE_LIMIT && isGoogleNewsArticleUrl(url)) {
      url = await resolveArticleUrl(url);
    }
    if (!isGenericNewsListingUrl(url)) {
      out.push({ ...item, url });
    }
  }
  return out;
}
