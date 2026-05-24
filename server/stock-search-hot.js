/**
 * 종목 검색 빈 화면 — 거래대금 상위(핫) 목록
 * KR: Naver sise_quant, US: Yahoo predefined most_actives (Nasdaq)
 */
import { resolveDisplayName } from "./names-ko.js";
import { fetchKrNaverQuotesBatch } from "./kr-naver-quote.js";
import { isPrimaryUsSearchSymbol } from "./stock-search-us-symbol.js";
import { getYahooSession, yahooGet } from "./yahoo.js";

const CACHE_MS = 60_000;
const HOT_COUNT = 10;
const NAVER_QUANT_URL = "https://finance.naver.com/sise/sise_quant.naver?sosok=0";
const UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";

/** @type {Map<string, { at: number, payload: { quotes: object[]; updatedAt: number } }>} */
const cache = new Map();

const NASDAQ_EXCHANGES = new Set(["NMS", "NCM", "NGM"]);

function parseCommaNum(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parsePercent(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s === "N/A") return null;
  const n = Number(s.replace("%", "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 레버리지·인버스 ETF 등 — 거래대금 상위에 잦음 */
function isLikelyKrEtfOrLeveraged(name) {
  const n = String(name ?? "");
  return /KODEX|TIGER|ETN\b|ETF\b|KOSEF|HANARO|ACE |SOL |RISE |\b2X\b|\b3X\b|인버스|레버리지|선물/i.test(
    n,
  );
}

/**
 * @param {string} html latin1로 읽은 HTML
 */
function parseNaverQuantRows(html) {
  const re =
    /class="no">\d+<\/td>\s*<td><a href="\/item\/main\.naver\?code=([0-9A-Z]{6})"[^>]*>([^<]*)<\/a><\/td>\s*<td class="number">([\d,]+)<\/td>[\s\S]*?([-+]?[\d.]+%)[\s\S]*?<td class="number">([\d,]+)<\/td>[\s\S]*?<td class="number">([\d,]+)<\/td>/g;
  /** @type {Array<{ code: string; name: string; price: number; changePercent: number | null; turnover: number }>} */
  const rows = [];
  let m;
  while ((m = re.exec(html)) != null && rows.length < 40) {
    const code = m[1];
    const name = m[2].trim();
    if (isLikelyKrEtfOrLeveraged(name)) continue;
    const price = parseCommaNum(m[3]);
    const turnoverM = parseCommaNum(m[6]);
    if (price == null || turnoverM == null || turnoverM <= 0) continue;
    rows.push({
      code,
      name,
      price,
      changePercent: parsePercent(m[4]),
      turnover: turnoverM * 1_000_000,
    });
  }
  rows.sort((a, b) => b.turnover - a.turnover);
  return rows.slice(0, HOT_COUNT);
}

async function fetchKrHotByTradingValue() {
  const res = await fetch(NAVER_QUANT_URL, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Naver quant HTTP ${res.status}`);
  const html = Buffer.from(await res.arrayBuffer()).toString("latin1");
  const parsed = parseNaverQuantRows(html);
  if (parsed.length === 0) throw new Error("Naver 거래대금 순위 파싱 실패");

  const symbols = parsed.map((r) => `${r.code}.KS`);
  const naverMap = await fetchKrNaverQuotesBatch(symbols);

  return parsed.map((row) => {
    const sym = `${row.code}.KS`;
    const nq = naverMap.get(row.code);
    return {
      symbol: sym,
      name: nq?.name?.trim() || row.name || sym,
      market: "kr",
      price: row.price,
      changePercent:
        row.changePercent ??
        (nq?.changePercent != null && Number.isFinite(nq.changePercent)
          ? nq.changePercent
          : undefined),
      currency: "KRW",
      turnover: row.turnover,
    };
  });
}

async function fetchUsHotByTradingValue() {
  await getYahooSession();
  const data = await yahooGet(
    `/v1/finance/screener/predefined/saved?scrIds=most_actives&count=80`,
  );
  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  /** @type {Array<{ symbol: string; name: string; market: string; price: number; changePercent: number | null; currency: string; turnover: number }>} */
  const rows = [];
  for (const q of quotes) {
    const symbol = String(q.symbol ?? "").trim().toUpperCase();
    const ex = String(q.exchange ?? "").trim().toUpperCase();
    if (!symbol || !isPrimaryUsSearchSymbol(symbol)) continue;
    if (!NASDAQ_EXCHANGES.has(ex)) continue;
    const price = Number(q.regularMarketPrice);
    const vol = Number(q.regularMarketVolume);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(vol) || vol <= 0) continue;
    const changePercent = Number(q.regularMarketChangePercent);
    rows.push({
      symbol,
      name: resolveDisplayName(symbol, q.shortName, q.longName),
      market: "us",
      price,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      currency: "USD",
      turnover: vol * price,
    });
  }
  rows.sort((a, b) => b.turnover - a.turnover);
  return rows.slice(0, HOT_COUNT);
}

/**
 * @param {"kr" | "us"} market
 */
export async function loadHotStocksByTurnover(market) {
  const key = `hot:${market}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.payload;

  const quotes =
    market === "kr"
      ? await fetchKrHotByTradingValue()
      : await fetchUsHotByTradingValue();

  const payload = { quotes, updatedAt: now };
  cache.set(key, { at: now, payload });
  return payload;
}
