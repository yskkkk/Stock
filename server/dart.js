import { inflateRawSync } from "node:zlib";

const BASE = "https://opendart.fss.or.kr/api";
const CACHE_MS = 10 * 60_000;
const DART_CACHE_MAX = 220;
const CORP_INDEX_TTL_MS = 26 * 60 * 60_000;
const cache = new Map();

/** @type {{ at: number; corps: Array<{ corpCode: string; corpName: string; stockCode: string }> } | null} */
let corpIndex = null;
/** @type {Promise<unknown> | null} */
let corpIndexLoad = null;

function pruneDartCache() {
  const now = Date.now();
  for (const [key, hit] of cache) {
    const ttl = key.startsWith("corp:")
      ? 26 * 60 * 60_000
      : key.startsWith("index:")
        ? CORP_INDEX_TTL_MS
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
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "000") return null;
  return data;
}

function extractFirstZipEntry(buffer) {
  const scanStart = Math.max(0, buffer.length - 65_536);
  for (let j = buffer.length - 4; j >= scanStart; j--) {
    if (
      buffer[j] !== 0x50 ||
      buffer[j + 1] !== 0x4b ||
      buffer[j + 2] !== 0x05 ||
      buffer[j + 3] !== 0x06
    ) {
      continue;
    }
    const cdOffset = buffer.readUInt32LE(j + 16);
    if (cdOffset <= 0 || cdOffset >= buffer.length) continue;
    const cd = buffer.subarray(cdOffset);
    if (cd[0] !== 0x50 || cd[1] !== 0x4b || cd[2] !== 0x01 || cd[3] !== 0x02) continue;

    const compSize = cd.readUInt32LE(20);
    const method = cd.readUInt16LE(10);
    const localOffset = cd.readUInt32LE(42);
    if (localOffset < 0 || localOffset >= buffer.length) continue;

    const fnLenL = buffer.readUInt16LE(localOffset + 26);
    const extraLenL = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + fnLenL + extraLenL;
    if (dataStart + compSize > buffer.length) continue;

    const compressed = buffer.subarray(dataStart, dataStart + compSize);
    if (method === 0) return compressed;
    if (method === 8) return inflateRawSync(compressed);
    return null;
  }
  return null;
}

/** @param {Buffer} buffer — tests·진단용 */
export function extractDartCorpZipEntry(buffer) {
  return extractFirstZipEntry(buffer);
}

function parseCorpXml(xml) {
  const text = xml.toString("utf8");
  /** @type {Array<{ corpCode: string; corpName: string; stockCode: string }>} */
  const corps = [];
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const corpCode = block.match(/<corp_code>([^<]*)<\/corp_code>/)?.[1]?.trim();
    const corpName = block.match(/<corp_name>([^<]*)<\/corp_name>/)?.[1]?.trim();
    const stockCode = block.match(/<stock_code>([^<]*)<\/stock_code>/)?.[1]?.trim();
    if (!corpCode || !corpName) continue;
    corps.push({
      corpCode,
      corpName,
      stockCode: stockCode ? stockCode.padStart(6, "0") : "",
    });
  }
  return corps;
}

export async function loadCorpIndex(force = false) {
  if (!isDartEnabled()) return [];
  if (!force && corpIndex && Date.now() - corpIndex.at < CORP_INDEX_TTL_MS) {
    return corpIndex.corps;
  }
  if (corpIndexLoad) return corpIndexLoad;

  corpIndexLoad = (async () => {
    const hit = cache.get("index:corps");
    if (!force && hit && Date.now() - hit.at < CORP_INDEX_TTL_MS) {
      corpIndex = { at: hit.at, corps: hit.corps };
      return hit.corps;
    }

    const key = apiKey();
    const url = `${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error("DART 고유번호 목록을 받지 못했습니다.");

    const buf = Buffer.from(await res.arrayBuffer());
    const entry = extractFirstZipEntry(buf);
    if (!entry) throw new Error("DART 고유번호 ZIP 파싱 실패");

    const corps = parseCorpXml(entry).filter((c) => c.stockCode);
    const at = Date.now();
    corpIndex = { at, corps };
    cache.set("index:corps", { at, corps });
    pruneDartCache();
    return corps;
  })()
    .finally(() => {
      corpIndexLoad = null;
    });

  return corpIndexLoad;
}

/** @param {string} symbol e.g. 005930.KS */
function stockCodeFromSymbol(symbol) {
  return symbol.replace(/\.(KS|KQ)$/i, "").padStart(6, "0");
}

export async function dartApiGet(path, params) {
  return dartGet(path, params);
}

/** @param {string} symbol e.g. 005930.KS */
export async function resolveDartCorpCode(symbol) {
  return resolveCorpCode(symbol);
}

async function resolveCorpCode(symbol) {
  const code = stockCodeFromSymbol(symbol);
  const hit = cache.get(`corp:${code}`);
  if (hit && Date.now() - hit.at < 24 * 60 * 60_000) return hit.corpCode;

  try {
    const corps = await loadCorpIndex();
    const found = corps.find((c) => c.stockCode === code);
    if (found?.corpCode) {
      cache.set(`corp:${code}`, { at: Date.now(), corpCode: found.corpCode });
      pruneDartCache();
      return found.corpCode;
    }
  } catch {
    /* corp index 실패 */
  }

  return null;
}

function formatDartDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function mapDisclosureRow(row, corpName = "") {
  const rcept = String(row.rcept_dt ?? "");
  const publishedAt =
    rcept.length === 8
      ? new Date(
          `${rcept.slice(0, 4)}-${rcept.slice(4, 6)}-${rcept.slice(6, 8)}T09:00:00+09:00`,
        ).getTime()
      : Date.now();

  const reportNm = row.report_nm ?? "공시";
  const url = row.rcept_no
    ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rcept_no}`
    : "https://dart.fss.or.kr/";

  const stockCode = String(row.stock_code ?? "").padStart(6, "0");
  const symbol =
    stockCode && stockCode !== "000000"
      ? `${stockCode}.${String(row.corp_cls ?? "Y").toUpperCase() === "K" ? "KQ" : "KS"}`
      : null;

  return {
    id: `dart:${row.rcept_no ?? rcept}:${reportNm}`,
    title: reportNm,
    url,
    source: "전자공시(DART)",
    publishedAt,
    type: "disclosure",
    corpCode: row.corp_code ?? null,
    corpName: corpName || row.corp_name || "",
    stockCode: stockCode || null,
    symbol,
    rceptNo: row.rcept_no ?? null,
    flrNm: row.flr_nm ?? "",
  };
}

function normalizeQuery(q) {
  return String(q ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} query
 * @param {number} [limit]
 */
export async function searchDartCompanies(query, limit = 25) {
  if (!isDartEnabled()) return [];
  const q = normalizeQuery(query);
  if (q.length < 1) return [];

  const corps = await loadCorpIndex();
  const { ensureKrSearchIndex, krYahooSymbolFromCode } = await import(
    "./kr-stock-search-index.js"
  );
  await ensureKrSearchIndex();
  const digits = q.replace(/\D/g, "");
  /** @type {Array<{ corpCode: string; corpName: string; stockCode: string; symbol: string; score: number }>} */
  const scored = [];

  for (const c of corps) {
    const name = c.corpName.toLowerCase();
    const code = c.stockCode;
    let score = 0;
    if (digits.length >= 4 && code.includes(digits)) score = 100;
    else if (digits.length >= 4 && code === digits.padStart(6, "0")) score = 120;
    else if (name === q) score = 90;
    else if (name.startsWith(q)) score = 70;
    else if (name.includes(q)) score = 40;
    if (score <= 0) continue;
    scored.push({
      corpCode: c.corpCode,
      corpName: c.corpName,
      stockCode: c.stockCode,
      symbol: krYahooSymbolFromCode(c.stockCode) || `${c.stockCode}.KS`,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.corpName.localeCompare(b.corpName, "ko"));
  return scored.slice(0, Math.min(Math.max(limit, 1), 50)).map(({ score: _s, ...row }) => row);
}

/**
 * @param {object} opts
 * @param {string} [opts.query]
 * @param {string} [opts.symbol]
 * @param {string} [opts.corpCode]
 * @param {number} [opts.days]
 * @param {number} [opts.page]
 * @param {number} [opts.pageSize]
 */
export async function searchDartDisclosures(opts = {}) {
  if (!isDartEnabled()) {
    return { enabled: false, items: [], total: 0, page: 1, pageSize: 30, hasMore: false };
  }

  const query = normalizeQuery(opts.query);
  const days = Math.min(Math.max(Number(opts.days) || 90, 7), 365);
  const page = Math.min(Math.max(Number(opts.page) || 1, 1), 20);
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 30, 5), 100);

  let corpCode = String(opts.corpCode ?? "").trim();
  const symbol = String(opts.symbol ?? "").trim().toUpperCase();
  if (!corpCode && symbol) {
    corpCode = (await resolveCorpCode(symbol)) ?? "";
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60_000);
  const cacheKey = `search:${corpCode || "all"}:${days}:${page}:${pageSize}:${query}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.payload;

  /** @type {Record<string, string>} */
  const params = {
    bgn_de: formatDartDate(start),
    end_de: formatDartDate(end),
    page_no: String(page),
    page_count: String(pageSize),
    sort: "date",
    sort_mth: "desc",
  };
  if (corpCode) params.corp_code = corpCode;

  const data = await dartGet("/list.json", params);
  const list = data?.list ?? [];

  let corpName = "";
  if (corpCode) {
    const corps = await loadCorpIndex();
    corpName = corps.find((c) => c.corpCode === corpCode)?.corpName ?? "";
  }

  let items = list.map((row) => mapDisclosureRow(row, corpName || row.corp_name || ""));
  if (query) {
    items = items.filter((it) => {
      const hay = `${it.title} ${it.corpName} ${it.flrNm}`.toLowerCase();
      return hay.includes(query);
    });
  }

  const total = Number(data?.total_count ?? items.length);
  const payload = {
    enabled: true,
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    corpCode: corpCode || null,
    days,
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  pruneDartCache();
  return payload;
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

  const result = await searchDartDisclosures({ symbol, days, page: 1, pageSize: 30 });
  const items = result.items;
  cache.set(cacheKey, { at: Date.now(), items });
  pruneDartCache();
  return items;
}

export function getDartStatus() {
  const enabled = isDartEnabled();
  if (!enabled) {
    return { enabled: false, corpIndexReady: false, corpCount: 0 };
  }
  if (corpIndex && Date.now() - corpIndex.at < CORP_INDEX_TTL_MS) {
    return {
      enabled: true,
      corpIndexReady: corpIndex.corps.length > 0,
      corpCount: corpIndex.corps.length,
    };
  }
  const hit = cache.get("index:corps");
  if (hit && Date.now() - hit.at < CORP_INDEX_TTL_MS) {
    return {
      enabled: true,
      corpIndexReady: hit.corps.length > 0,
      corpCount: hit.corps.length,
    };
  }
  return { enabled: true, corpIndexReady: false, corpCount: 0 };
}
