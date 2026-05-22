/**
 * 국내 주식 최신가 — Naver Finance polling (정규장·시간외 단일가·시간외 종가).
 * Yahoo 1분봉은 15:30에 끊기는 경우가 많아 KR은 Naver를 우선한다.
 */
const NAVER_POLL_URL =
  "https://polling.finance.naver.com/api/realtime/domestic/stock";
const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const CACHE_MS = Math.max(
  15_000,
  Number(process.env.KR_NAVER_QUOTE_TTL_MS) || 30_000,
);
const BATCH_SIZE = Math.min(
  80,
  Math.max(10, Number(process.env.KR_NAVER_QUOTE_BATCH_SIZE) || 50),
);

/** @type {Map<string, { at: number; quote: KrNaverQuote | null }>} */
const cache = new Map();

export function krNaverQuotesEnabled() {
  const v = String(process.env.KR_NAVER_QUOTE ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/**
 * @param {string} symbol
 * @returns {string | null} 6자리 코드
 */
export function yahooSymbolToKrCode(symbol) {
  const u = String(symbol ?? "")
    .trim()
    .toUpperCase();
  const m = u.match(/^(\d{6})(?:\.(KS|KQ))?$/);
  return m ? m[1] : null;
}

/** @param {string} symbol */
export function isKrQuoteSymbol(symbol) {
  return yahooSymbolToKrCode(symbol) != null;
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseKrCommaPrice(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {Record<string, unknown>} d Naver datas[] row
 * @returns {KrNaverQuote | null}
 */
export function parseNaverDomesticRow(d) {
  if (!d || typeof d !== "object") return null;
  const code = String(d.itemCode ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;

  const regularPx = parseKrCommaPrice(d.closePrice);
  const regularMs = Date.parse(String(d.localTradedAt ?? "")) || 0;
  if (regularPx == null) return null;

  let price = regularPx;
  let quotedAtMs = regularMs > 0 ? regularMs : Date.now();
  /** @type {'regular' | 'over'} */
  let priceSource = "regular";
  let changePercent = parseKrPercent(d.fluctuationsRatio);

  const over = d.overMarketPriceInfo;
  if (over && typeof over === "object") {
    const overPx = parseKrCommaPrice(over.overPrice);
    const overMs = Date.parse(String(over.localTradedAt ?? "")) || 0;
    if (overPx != null && overMs > 0 && overMs >= quotedAtMs) {
      price = overPx;
      quotedAtMs = overMs;
      priceSource = "over";
      const overPct = parseKrPercent(over.fluctuationsRatio);
      if (overPct != null) changePercent = overPct;
    }
  }

  const yahooSym = `${code}.KS`;
  return {
    code,
    yahooSymbol: yahooSym,
    name: String(d.stockName ?? code),
    price,
    changePercent: changePercent ?? undefined,
    currency: "KRW",
    quotedAtMs,
    priceSource,
    marketStatus: String(d.marketStatus ?? ""),
  };
}

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function parseKrPercent(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string[]} codes 6자리, 중복 제거됨
 * @returns {Promise<Map<string, KrNaverQuote>>}
 */
async function fetchNaverByCodes(codes) {
  /** @type {Map<string, KrNaverQuote>} */
  const out = new Map();
  if (!codes.length || !krNaverQuotesEnabled()) return out;

  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const chunk = codes.slice(i, i + BATCH_SIZE);
    const url = `${NAVER_POLL_URL}/${chunk.join(",")}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const rows = Array.isArray(data?.datas) ? data.datas : [];
      for (const row of rows) {
        const q = parseNaverDomesticRow(row);
        if (q) out.set(q.code, q);
      }
    } catch {
      /* chunk 실패 — 개별 Yahoo 폴백 */
    }
  }
  return out;
}

/**
 * @param {string[]} yahooOrBareSymbols
 * @returns {Promise<Map<string, KrNaverQuote>>} key = 6자리 code
 */
export async function fetchKrNaverQuotesBatch(yahooOrBareSymbols) {
  const codes = [
    ...new Set(
      (Array.isArray(yahooOrBareSymbols) ? yahooOrBareSymbols : [])
        .map(yahooSymbolToKrCode)
        .filter(Boolean),
    ),
  ];
  /** @type {Map<string, KrNaverQuote>} */
  const out = new Map();
  const needFetch = [];
  const now = Date.now();

  for (const code of codes) {
    const hit = cache.get(code);
    if (hit && now - hit.at < CACHE_MS && hit.quote) {
      out.set(code, hit.quote);
    } else {
      needFetch.push(code);
    }
  }

  if (needFetch.length > 0) {
    const fresh = await fetchNaverByCodes(needFetch);
    const at = Date.now();
    for (const code of needFetch) {
      const q = fresh.get(code) ?? null;
      cache.set(code, { at, quote: q });
      if (q) out.set(code, q);
    }
  }

  return out;
}

/**
 * @param {string} symbol
 * @returns {Promise<KrNaverQuote | null>}
 */
export async function fetchKrNaverQuoteForSymbol(symbol) {
  const code = yahooSymbolToKrCode(symbol);
  if (!code) return null;
  const map = await fetchKrNaverQuotesBatch([symbol]);
  return map.get(code) ?? null;
}

/**
 * @param {KrNaverQuote} q
 * @returns {object} loadChartQuoteSnapshot / picks-live-quotes 호환
 */
export function naverQuoteToSnapshot(q) {
  return {
    symbol: q.yahooSymbol,
    name: q.name,
    price: q.price,
    changePercent: q.changePercent,
    currency: q.currency,
    quotedAtMs: q.quotedAtMs,
    priceSource: q.priceSource,
    interval: q.priceSource,
    marketState: q.marketStatus,
  };
}

/**
 * @param {string} symbol
 * @returns {Promise<object | null>}
 */
export async function loadKrLatestQuoteSnapshot(symbol) {
  const q = await fetchKrNaverQuoteForSymbol(symbol);
  if (!q) return null;
  return naverQuoteToSnapshot(q);
}

/**
 * @typedef {object} KrNaverQuote
 * @property {string} code
 * @property {string} yahooSymbol
 * @property {string} name
 * @property {number} price
 * @property {number} [changePercent]
 * @property {string} currency
 * @property {number} quotedAtMs
 * @property {'regular' | 'over'} priceSource
 * @property {string} marketStatus
 */
