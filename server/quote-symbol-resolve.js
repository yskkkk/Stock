/**
 * Yahoo 시세 조회·병합용 심볼 정규화 (6자리 국내코드 ↔ .KS)
 */

/** @param {string} symbol */
export function inferMarketFromSymbol(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (/\.(KS|KQ)$/.test(s)) return "kr";
  if (/^\d{6}$/.test(s)) return "kr";
  return "us";
}

/**
 * @param {string} symbol
 * @param {"kr" | "us" | null | undefined} [market]
 */
export function normalizeYahooQuoteSymbol(symbol, market) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (!s) return s;
  if (/\.(KS|KQ)$/i.test(s) || s.includes("-")) return s;
  const m = market === "kr" || market === "us" ? market : inferMarketFromSymbol(s);
  if (m === "kr" && /^\d{6}$/.test(s)) return `${s}.KS`;
  return s;
}

/**
 * @param {Record<string, { price?: number; changePercent?: number; currency?: string }>} quotes
 * @param {string} symbol
 * @param {"kr" | "us" | null | undefined} [market]
 */
export function pickQuoteFromMap(quotes, symbol, market) {
  if (!quotes || typeof quotes !== "object") return null;
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return null;

  if (market === "crypto") {
    const direct = quotes[raw];
    if (direct?.price != null && Number.isFinite(direct.price) && direct.price > 0) {
      return direct;
    }
    return null;
  }

  const direct = quotes[raw];
  if (direct?.price != null && Number.isFinite(direct.price) && direct.price > 0) {
    return direct;
  }

  const norm = normalizeYahooQuoteSymbol(raw, market);
  if (norm !== raw) {
    const hit = quotes[norm];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) {
      return hit;
    }
  }

  const bare = raw.replace(/\.(KS|KQ)$/i, "");
  if (bare !== raw) {
    const hit = quotes[bare];
    if (hit?.price != null && Number.isFinite(hit.price) && hit.price > 0) {
      return hit;
    }
  }

  return null;
}

/**
 * @param {string[]} symbols
 * @param {"kr" | "us"} [defaultMarket]
 */
export function expandSymbolsForYahooQuotes(symbols, defaultMarket = "kr") {
  const out = new Set();
  for (const s of symbols) {
    const raw = String(s ?? "").trim().toUpperCase();
    if (!raw) continue;
    out.add(raw);
    const m =
      raw.endsWith(".KS") || raw.endsWith(".KQ") || /^\d{6}$/.test(raw)
        ? inferMarketFromSymbol(raw)
        : defaultMarket;
    const norm = normalizeYahooQuoteSymbol(raw, m);
    if (norm) out.add(norm);
  }
  return [...out];
}
