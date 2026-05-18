const BASE = "https://opendart.fss.or.kr/api";
const CACHE_MS = 10 * 60_000;
const DART_CACHE_MAX = 180;
const cache = new Map();

function pruneDartCache() {
  const now = Date.now();
  for (const [key, hit] of cache) {
    const ttl = key.startsWith("corp:")
      ? 26 * 60 * 60_000
      : CACHE_MS * 4;
    if (now - hit.at > ttl) cache.delete(key);
  }
  if (cache.size <= DART_CACHE_MAX) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  const remove = cache.size - DART_CACHE_MAX;
  for (let i = 0; i < remove; i++) cache.delete(sorted[i][0]);
}

function apiKey() {
  return process.env.OPENDART_API_KEY?.trim() ?? "";
}

export function isDartEnabled() {
  return apiKey().length >= 20;
}

async function dartGet(path, params) {
  const key = apiKey();
  if (!key) return null;

  const qs = new URLSearchParams({ crtfc_key: key, ...params });
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "000") return null;
  return data;
}

/** @param {string} symbol e.g. 005930.KS */
function stockCodeFromSymbol(symbol) {
  return symbol.replace(/\.(KS|KQ)$/i, "").padStart(6, "0");
}

async function resolveCorpCode(symbol) {
  const code = stockCodeFromSymbol(symbol);
  const hit = cache.get(`corp:${code}`);
  if (hit && Date.now() - hit.at < 24 * 60 * 60_000) return hit.corpCode;

  const data = await dartGet("/company.json", { stock_code: code });
  const corpCode = data?.corp_code;
  if (!corpCode) return null;

  cache.set(`corp:${code}`, { at: Date.now(), corpCode });
  pruneDartCache();
  return corpCode;
}

function formatDartDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * @param {string} symbol
 * @param {number} [days]
 */
export async function fetchDartDisclosures(symbol, days = 90) {
  if (!symbol.toUpperCase().endsWith(".KS") && !symbol.toUpperCase().endsWith(".KQ")) {
    return [];
  }
  if (!isDartEnabled()) return [];

  const cacheKey = `list:${symbol}:${days}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  const corpCode = await resolveCorpCode(symbol);
  if (!corpCode) return [];

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60_000);
  const data = await dartGet("/list.json", {
    corp_code: corpCode,
    bgn_de: formatDartDate(start),
    end_de: formatDartDate(end),
    page_count: "30",
    sort: "date",
    sort_mth: "desc",
  });

  const list = data?.list ?? [];
  const items = list.map((row) => {
    const rcept = String(row.rcept_dt ?? "");
    const publishedAt = rcept.length === 8
      ? new Date(
          `${rcept.slice(0, 4)}-${rcept.slice(4, 6)}-${rcept.slice(6, 8)}T09:00:00+09:00`,
        ).getTime()
      : Date.now();

    const reportNm = row.report_nm ?? "공시";
    const url = row.rcept_no
      ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rcept_no}`
      : "https://dart.fss.or.kr/";

    return {
      id: `dart:${row.rcept_no ?? rcept}:${reportNm}`,
      title: reportNm,
      url,
      source: "전자공시(DART)",
      publishedAt,
      type: "disclosure",
    };
  });

  cache.set(cacheKey, { at: Date.now(), items });
  pruneDartCache();
  return items;
}
