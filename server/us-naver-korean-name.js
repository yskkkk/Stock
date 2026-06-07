import { getKoreanStockName, hasHangul, registerKoreanName } from "./names-ko.js";

const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, { at: number; name: string | null }>} */
const cache = new Map();

/** @param {string} symbol */
export function normalizeUsTicker(symbol) {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(KS|KQ)$/i, "")
    .replace(/^KR_/i, "");
}

/**
 * @param {string} naverCode
 * @returns {Promise<string | null>}
 */
async function fetchNaverBasicName(naverCode) {
  const code = String(naverCode ?? "").trim();
  if (!code) return null;
  try {
    const res = await fetch(
      `https://api.stock.naver.com/stock/${encodeURIComponent(code)}/basic`,
      {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code === "StockConflict") return null;
    const name = String(data?.stockName ?? "").trim();
    return name && hasHangul(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} symbol
 * @returns {Promise<string | null>}
 */
export async function resolveUsKoreanStockName(symbol) {
  const sym = normalizeUsTicker(symbol);
  if (!sym) return null;

  const local = getKoreanStockName(sym);
  if (local) return local;

  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.name;

  for (const code of [sym, `${sym}.O`, `${sym}.N`]) {
    const name = await fetchNaverBasicName(code);
    if (name) {
      cache.set(sym, { at: Date.now(), name });
      registerKoreanName(sym, name);
      return name;
    }
  }

  cache.set(sym, { at: Date.now(), name: null });
  return null;
}

/**
 * @param {string[]} symbols
 * @param {number} [concurrency]
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveUsKoreanStockNamesBatch(symbols, concurrency = 6) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const uniq = [
    ...new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map(normalizeUsTicker)
        .filter(Boolean),
    ),
  ];
  const limit = Math.max(1, Math.min(concurrency, 12));

  for (let i = 0; i < uniq.length; i += limit) {
    const chunk = uniq.slice(i, i + limit);
    await Promise.all(
      chunk.map(async (sym) => {
        const name = await resolveUsKoreanStockName(sym);
        if (name) out.set(sym, name);
      }),
    );
  }
  return out;
}
