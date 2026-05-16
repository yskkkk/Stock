const HANGUL_RE = /[\uAC00-\uD7A3]/g;
const LATIN_RE = /[a-zA-Z]/g;

const cache = new Map();
const CACHE_MAX = 2000;

/** 한글이 주를 이루면 번역 생략 */
export function needsTranslation(text) {
  if (!text?.trim()) return false;
  const hangul = (text.match(HANGUL_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  if (hangul >= 4 && hangul >= latin) return false;
  if (hangul > 0 && latin === 0) return false;
  return latin > 0 || hangul === 0;
}

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function translateToKorean(text) {
  const src = text.trim();
  if (!src || !needsTranslation(src)) return src;

  const hit = cache.get(src);
  if (hit) return hit;

  const url =
    "https://translate.googleapis.com/translate_a/single?" +
    new URLSearchParams({
      client: "gtx",
      sl: "auto",
      tl: "ko",
      dt: "t",
      q: src,
    });

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) return src;

  const data = await res.json();
  const translated = data?.[0]?.map((part) => part?.[0]).join("")?.trim();
  const out = translated || src;

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(src, out);
  return out;
}

async function runPool(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

/**
 * @param {Array<{ title: string, [key: string]: unknown }>} items
 */
export async function translateNewsTitles(items) {
  const tasks = items.map((item) => async () => {
    if (!needsTranslation(item.title)) return item;
    try {
      const title = await translateToKorean(item.title);
      return { ...item, title };
    } catch {
      return item;
    }
  });
  return runPool(tasks, 5);
}
