/**
 * Google News RSS article URL → publisher URL
 * @see https://gist.github.com/huksley/bc3cb046157a99cd9d1517b32f91a99e (MIT)
 */

const decodeCache = new Map();
const DECODE_CACHE_MAX = 450;

function pruneDecodeCache() {
  if (decodeCache.size <= DECODE_CACHE_MAX) return;
  const sorted = [...decodeCache.entries()].sort((a, b) => a[1].at - b[1].at);
  const remove = decodeCache.size - DECODE_CACHE_MAX;
  for (let i = 0; i < remove; i++) decodeCache.delete(sorted[i][0]);
}

function isGoogleNewsArticleUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.hostname === "news.google.com" &&
      /\/articles\//i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function articleIdFromUrl(sourceUrl) {
  const parts = new URL(sourceUrl).pathname.split("/");
  return parts[parts.length - 1]?.split("?")[0] ?? "";
}

async function fetchArticleMeta(articleId, sourceUrl) {
  const pageUrl =
    sourceUrl && /\/rss\/articles\//i.test(sourceUrl)
      ? sourceUrl.split("?")[0]
      : `https://news.google.com/rss/articles/${articleId}`;
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`article page ${res.status}`);
  const html = await res.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error("article meta missing");
  return { articleId, signature: sg, timestamp: ts };
}

async function fetchDecodedWithMeta(meta) {
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${meta.articleId}",${meta.timestamp},"${meta.signature}"]`;
  const payload = `f.req=${encodeURIComponent(
    JSON.stringify([[["Fbv4je", inner]]]),
  )}`;

  const res = await fetch(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: "https://news.google.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: payload,
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) throw new Error(`batchexecute ${res.status}`);

  const text = await res.text();
  const chunk = text.split("\n\n")[1];
  if (!chunk) throw new Error("batchexecute body missing");
  const parsed = JSON.parse(chunk);
  const entry = parsed?.[0];
  const decoded = entry?.[2] ? JSON.parse(entry[2])?.[1] : null;
  if (typeof decoded !== "string" || !/^https?:\/\//i.test(decoded)) {
    throw new Error("decoded url invalid");
  }
  return decoded;
}

function decodeGoogleNewsUrlSync(sourceUrl) {
  const articleId = articleIdFromUrl(sourceUrl);
  if (!articleId) return null;

  let str = Buffer.from(articleId, "base64").toString("binary");
  const prefix = Buffer.from([0x08, 0x13, 0x22]).toString("binary");
  if (str.startsWith(prefix)) str = str.slice(prefix.length);

  const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString("binary");
  if (str.endsWith(suffix)) str = str.slice(0, -suffix.length);

  const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
  const len = bytes[0];
  if (len >= 0x80) {
    str = str.substring(2, len + 2);
  } else {
    str = str.substring(1, len + 1);
  }

  if (str.startsWith("AU_")) return null;
  if (/^https?:\/\//i.test(str)) return str;
  return null;
}

/**
 * @param {string} sourceUrl
 * @returns {Promise<string>}
 */
export async function decodeGoogleNewsUrl(sourceUrl) {
  if (!isGoogleNewsArticleUrl(sourceUrl)) return sourceUrl;

  const hit = decodeCache.get(sourceUrl);
  if (hit && Date.now() - hit.at < 24 * 60 * 60_000) return hit.url;

  const articleId = articleIdFromUrl(sourceUrl);
  let resolved = decodeGoogleNewsUrlSync(sourceUrl);

  if (!resolved && articleId) {
    try {
      const meta = await fetchArticleMeta(articleId, sourceUrl);
      resolved = await fetchDecodedWithMeta(meta);
    } catch {
      resolved = sourceUrl;
    }
  }

  try {
    const u = new URL(resolved);
    if (!/^https?:$/i.test(u.protocol)) resolved = sourceUrl;
  } catch {
    resolved = sourceUrl;
  }

  decodeCache.set(sourceUrl, { at: Date.now(), url: resolved });
  pruneDecodeCache();
  return resolved;
}

export { isGoogleNewsArticleUrl };
