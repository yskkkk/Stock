/**
 * 국내 종목 업종 — Yahoo assetProfile 미제공 시 Naver integration industryCode
 */
import { yahooSymbolToKrCode } from "./kr-naver-quote.js";

const NAVER_INTEGRATION_URL = "https://m.stock.naver.com/api/stock";
const NAVER_UPJONG_URL =
  "https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=";
const NAVER_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const CACHE_MS = 7 * 24 * 60 * 60_000;

/** @type {Map<string, { at: number; code: string | null }>} */
const codeCache = new Map();
/** @type {Map<string, { at: number; name: string | null }>} */
const nameCache = new Map();

/**
 * @param {string} industryCode
 */
async function fetchKrNaverUpjongName(industryCode) {
  const code = String(industryCode ?? "").trim();
  if (!code) return null;

  const hit = nameCache.get(code);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.name;

  try {
    const res = await fetch(`${NAVER_UPJONG_URL}${encodeURIComponent(code)}`, {
      headers: { "User-Agent": NAVER_UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      nameCache.set(code, { at: Date.now(), name: null });
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const html = new TextDecoder("euc-kr").decode(buf);
    const m = html.match(/<title>([^<:]+)/i);
    const raw = m?.[1]?.trim() ?? null;
    nameCache.set(code, { at: Date.now(), name: raw });
    return raw;
  } catch {
    nameCache.set(code, { at: Date.now(), name: null });
    return null;
  }
}

/**
 * @param {string} symbol
 */
async function fetchKrNaverIndustryCode(symbol) {
  const krCode = yahooSymbolToKrCode(symbol);
  if (!krCode) return null;

  const hit = codeCache.get(krCode);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.code;

  try {
    const res = await fetch(`${NAVER_INTEGRATION_URL}/${krCode}/integration`, {
      headers: { "User-Agent": NAVER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      codeCache.set(krCode, { at: Date.now(), code: null });
      return null;
    }
    const body = await res.json();
    const industryCode =
      body?.industryCode != null ? String(body.industryCode).trim() : null;
    codeCache.set(krCode, { at: Date.now(), code: industryCode || null });
    return industryCode || null;
  } catch {
    codeCache.set(krCode, { at: Date.now(), code: null });
    return null;
  }
}

/**
 * @param {string} symbol
 * @returns {Promise<string | null>} Naver 업종 페이지 제목(예: 반도체와반도체장비)
 */
export async function fetchKrNaverIndustryRawName(symbol) {
  const industryCode = await fetchKrNaverIndustryCode(symbol);
  if (!industryCode) return null;
  return fetchKrNaverUpjongName(industryCode);
}
