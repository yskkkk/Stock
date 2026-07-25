/**
 * 나스닥 상장 ETF 목록 (Yahoo screener + 네이버 한글명·설명).
 */
import { getKoreanStockName, hasHangul, resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooGet, yahooPost } from "./yahoo.js";

/** Nasdaq Global Select / Global Market / Capital Market */
const NASDAQ_ETF_EXCHANGES = ["NMS", "NGM", "NAS", "NCM"];

const TARGET = (() => {
  const n = Number(process.env.STOCK_NASDAQ_ETF_TARGET ?? 2500);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 5000) : 2500;
})();

const CACHE_MS = 6 * 60 * 60 * 1000;
const NAVER_UA =
  "Mozilla/5.0 (compatible; StockDashboard/1.0; +https://github.com/yskkkk/Stock)";
const PINION_KO_MAP_URL =
  "https://raw.githubusercontent.com/pinion05/kr-us-stock-name-ticker-maps/main/data/us/us-stock-ticker-to-ko-en-coverage100.json";

const BRAND_KO = [
  [/Invesco/i, "인베스코"],
  [/ProShares/i, "프로셰어즈"],
  [/Vanguard/i, "뱅가드"],
  [/Direxion/i, "디렉시온"],
  [/iShares/i, "아이셰어즈"],
  [/SPDR/i, "SPDR"],
  [/Schwab/i, "슈왑"],
  [/Fidelity/i, "피델리티"],
  [/Global\s*X/i, "글로벌X"],
  [/ARK/i, "ARK"],
  [/First\s*Trust/i, "퍼스트트러스트"],
  [/WisdomTree/i, "위즈덤트리"],
  [/VanEck/i, "밴엑"],
  [/Amplify/i, "앰플리파이"],
];

/** @type {{ data: object; at: number } | null} */
let cached = null;
/** @type {Map<string, string> | null} */
let pinionKoByTicker = null;

/**
 * @param {string} region
 * @param {number} offset
 * @param {number} size
 * @param {string} exchange
 */
async function fetchEtfScreenerPage(region, offset, size, exchange) {
  const operands = [{ operator: "eq", operands: ["region", region] }];
  const ex = String(exchange ?? "").trim();
  if (ex) {
    operands.push({ operator: "eq", operands: ["exchange", ex] });
  }
  const body = {
    size,
    offset,
    sortField: "fundnetassets",
    sortType: "DESC",
    quoteType: "ETF",
    query: {
      operator: "AND",
      operands,
    },
  };

  let data;
  try {
    data = await yahooPost("/v1/finance/screener", body);
  } catch {
    data = await yahooPost("/v1/finance/screener", {
      ...body,
      sortField: "intradaymarketcap",
    });
  }

  const quotes = data?.finance?.result?.[0]?.quotes ?? [];
  return quotes
    .map((q) => {
      const symbol = String(q.symbol ?? "").trim().toUpperCase();
      if (!symbol) return null;
      const exchangeCode = String(q.exchange ?? exchange ?? "")
        .trim()
        .toUpperCase();
      const exchDisp = String(q.exchDisp ?? q.fullExchangeName ?? "").trim();
      const priceRaw = q.regularMarketPrice ?? q.intradayprice;
      const changeRaw = q.regularMarketChangePercent ?? q.percentchange;
      const aumRaw = q.fundNetAssets ?? q.netAssets;
      return {
        symbol,
        name: resolveDisplayName(symbol, q.shortName, q.longName),
        nameKo: null,
        description: null,
        categoryKo: null,
        exchange: exchangeCode || null,
        exchangeDisp: exchDisp || null,
        price:
          typeof priceRaw === "number" && Number.isFinite(priceRaw)
            ? priceRaw
            : null,
        changePercent:
          typeof changeRaw === "number" && Number.isFinite(changeRaw)
            ? changeRaw
            : null,
        netAssets:
          typeof aumRaw === "number" && Number.isFinite(aumRaw) ? aumRaw : null,
      };
    })
    .filter(Boolean);
}

/**
 * @param {string} region
 * @param {string} exchange
 * @param {number} target
 */
async function fetchExchangeEtfUniverse(region, exchange, target) {
  const out = [];
  const seen = new Set();
  const ex = String(exchange ?? "").trim();
  if (!ex) return [];

  for (
    let offset = 0;
    offset < Math.max(target * 4, 8_000) && out.length < target;
    offset += 250
  ) {
    try {
      const page = await fetchEtfScreenerPage(region, offset, 250, ex);
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
        }
      }
      if (page.length < 50) break;
    } catch (e) {
      console.warn(
        "[nasdaq-etf] screener:",
        ex,
        e instanceof Error ? e.message : e,
      );
      break;
    }
  }

  return out;
}

/** @returns {Promise<Map<string, string>>} */
async function loadPinionKoByTicker() {
  if (pinionKoByTicker) return pinionKoByTicker;
  /** @type {Map<string, string>} */
  const map = new Map();
  try {
    const res = await fetch(PINION_KO_MAP_URL, {
      headers: { "User-Agent": NAVER_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const [ticker, row] of Object.entries(data ?? {})) {
        const ko = String(row?.name_ko ?? "").trim();
        if (ko && hasHangul(ko)) map.set(String(ticker).toUpperCase(), ko);
      }
    }
  } catch {
    /* offline */
  }
  pinionKoByTicker = map;
  return map;
}

/**
 * @param {string} code
 * @returns {Promise<object | null>}
 */
async function fetchNaverEtfBasicRaw(code) {
  const c = String(code ?? "").trim();
  if (!c) return null;
  try {
    const res = await fetch(
      `https://api.stock.naver.com/etf/${encodeURIComponent(c)}/basic`,
      {
        headers: { "user-agent": NAVER_UA },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code === "StockConflict") return null;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {string} symbol
 * @returns {Promise<{
 *   tip: string | null;
 *   large: string | null;
 *   middle: string | null;
 * } | null>}
 */
async function fetchNaverEtfMeta(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  for (const code of [`${sym}.O`, `${sym}.N`, sym]) {
    const data = await fetchNaverEtfBasicRaw(code);
    if (!data) continue;
    const tip = String(data.indexOrEtfToolTip ?? "").trim();
    const large = String(data.largeCodeName ?? "").trim();
    const middle = String(data.middleCodeName ?? "").trim();
    if (tip || large || middle) {
      return {
        tip: tip || null,
        large: large && hasHangul(large) ? large : null,
        middle: middle && hasHangul(middle) ? middle : null,
      };
    }
  }
  return null;
}

/**
 * @param {string} englishName
 * @param {string} symbol
 * @param {{ large: string | null; middle: string | null } | null} naver
 */
function buildNameKo(englishName, symbol, naver) {
  const mapped = getKoreanStockName(symbol);
  if (mapped && hasHangul(mapped)) return mapped;

  let brand = null;
  for (const [re, ko] of BRAND_KO) {
    if (re.test(englishName)) {
      brand = ko;
      break;
    }
  }
  if (brand) return `${brand} ${symbol}`;

  if (naver?.middle) return `${naver.middle} · ${symbol}`;
  if (naver?.large) return `${naver.large} · ${symbol}`;
  return null;
}

/**
 * @param {string} symbol
 */
async function fetchYahooEtfDescription(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  try {
    const data = await yahooGet(
      `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=assetProfile,fundProfile`,
    );
    const row = data?.quoteSummary?.result?.[0];
    const summary = String(row?.assetProfile?.longBusinessSummary ?? "").trim();
    if (summary) return summary;
    const family = String(row?.fundProfile?.family ?? "").trim();
    const category = String(row?.fundProfile?.categoryName ?? "").trim();
    if (family || category) {
      return [family, category].filter(Boolean).join(" · ");
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {Array<object>} etfs
 * @param {number} concurrency
 */
async function enrichKoreanMeta(etfs, concurrency = 10) {
  const pinion = await loadPinionKoByTicker();

  for (const row of etfs) {
    const sym = row.symbol;
    const pinionKo = pinion.get(sym) ?? pinion.get(sym.replace(/-/g, "."));
    if (pinionKo && hasHangul(pinionKo)) {
      row.nameKo = pinionKo;
      continue;
    }
    const quick = buildNameKo(row.name || "", sym, null);
    if (quick && hasHangul(quick)) row.nameKo = quick;
  }

  const naverTargets = etfs.slice(0, 700);
  const limit = Math.max(1, Math.min(concurrency, 12));
  /** @type {object[]} */
  const needYahooDesc = [];

  for (let i = 0; i < naverTargets.length; i += limit) {
    const chunk = naverTargets.slice(i, i + limit);
    await Promise.all(
      chunk.map(async (row) => {
        const naver = await fetchNaverEtfMeta(row.symbol);
        if (!naver) {
          if (!row.description) needYahooDesc.push(row);
          return;
        }
        if (!row.nameKo || !hasHangul(row.nameKo)) {
          const built = buildNameKo(row.name || "", row.symbol, naver);
          if (built && hasHangul(built)) row.nameKo = built;
        }
        if (naver.tip) row.description = naver.tip;
        else needYahooDesc.push(row);

        const cat = [naver.large, naver.middle].filter(Boolean).join(" · ");
        row.categoryKo = cat || null;
      }),
    );
  }

  for (const row of etfs.slice(700)) {
    if (!row.description) needYahooDesc.push(row);
  }

  const yahooTargets = needYahooDesc.filter((r) => !r.description).slice(0, 80);
  for (let i = 0; i < yahooTargets.length; i += 4) {
    const chunk = yahooTargets.slice(i, i + 4);
    await Promise.all(
      chunk.map(async (row) => {
        const desc = await fetchYahooEtfDescription(row.symbol);
        if (desc) row.description = desc;
      }),
    );
  }
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{
 *   etfs: Array<object>;
 *   count: number;
 *   updatedAt: number;
 *   source: string;
 * }>}
 */
export async function fetchNasdaqEtfsPayload(opts = {}) {
  const force = Boolean(opts.force);
  const now = Date.now();
  if (!force && cached && now - cached.at < CACHE_MS) {
    return cached.data;
  }

  await getYahooSession();
  const perEx = Math.ceil(TARGET / NASDAQ_ETF_EXCHANGES.length) + 200;
  /** @type {Map<string, object>} */
  const bySym = new Map();

  for (const ex of NASDAQ_ETF_EXCHANGES) {
    const part = await fetchExchangeEtfUniverse("us", ex, perEx);
    for (const row of part) {
      if (!bySym.has(row.symbol)) bySym.set(row.symbol, row);
    }
  }

  const etfs = [...bySym.values()].sort((a, b) => {
    const an = a.netAssets;
    const bn = b.netAssets;
    if (an != null && bn != null && an !== bn) return bn - an;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  try {
    await enrichKoreanMeta(etfs);
  } catch (e) {
    console.warn(
      "[nasdaq-etf] korean enrich:",
      e instanceof Error ? e.message : e,
    );
  }

  const data = {
    etfs,
    count: etfs.length,
    updatedAt: Date.now(),
    source: "yahoo-screener-etf-nasdaq+naver",
  };
  cached = { data, at: Date.now() };
  return data;
}

const HOLDINGS_CACHE_MS = 60 * 60 * 1000;
/** @type {Map<string, { data: object; at: number }>} */
const holdingsCache = new Map();

const SECTOR_KO = {
  technology: "정보기술",
  communication_services: "커뮤니케이션",
  consumer_cyclical: "임의소비재",
  consumer_defensive: "필수소비재",
  financial_services: "금융",
  healthcare: "헬스케어",
  industrials: "산업재",
  basic_materials: "소재",
  energy: "에너지",
  utilities: "유틸리티",
  realestate: "부동산",
};

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function yahooPct(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "object" && raw && "raw" in /** @type {object} */ (raw)) {
    const n = Number(/** @type {{ raw?: unknown }} */ (raw).raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * @param {unknown} sectors
 * @returns {Array<{ key: string; label: string; weight: number }>}
 */
function parseSectorWeightings(sectors) {
  if (!Array.isArray(sectors)) return [];
  /** @type {Array<{ key: string; label: string; weight: number }>} */
  const out = [];
  for (const row of sectors) {
    if (!row || typeof row !== "object") continue;
    for (const [key, val] of Object.entries(row)) {
      const weight = yahooPct(val);
      if (weight == null || weight <= 0) continue;
      out.push({
        key,
        label: SECTOR_KO[key] ?? key.replace(/_/g, " "),
        weight,
      });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * @param {string} symbol
 */
export async function fetchNasdaqEtfHoldingsPayload(symbol) {
  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "-");
  if (!sym) {
    return {
      symbol: "",
      holdings: [],
      sectors: [],
      allocation: null,
      updatedAt: Date.now(),
      source: "yahoo-topHoldings",
      note: null,
    };
  }

  const hit = holdingsCache.get(sym);
  const now = Date.now();
  if (hit && now - hit.at < HOLDINGS_CACHE_MS) return hit.data;

  await getYahooSession();
  const data = await yahooGet(
    `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=topHoldings,fundProfile,price`,
  );
  const row = data?.quoteSummary?.result?.[0] ?? {};
  const th = row.topHoldings ?? {};
  const price = row.price ?? {};
  const fund = row.fundProfile ?? {};

  const rawHoldings = Array.isArray(th.holdings) ? th.holdings : [];
  const holdings = rawHoldings
    .map((h) => {
      const hSym = String(h?.symbol ?? "").trim().toUpperCase();
      if (!hSym) return null;
      const weight = yahooPct(h?.holdingPercent);
      const name = String(h?.holdingName ?? "").trim() || hSym;
      const nameKo = getKoreanStockName(hSym);
      return {
        symbol: hSym,
        name,
        nameKo: nameKo && hasHangul(nameKo) ? nameKo : null,
        weight: weight != null ? weight : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  // 보유 종목 한글명 보강 (소량)
  try {
    const { resolveUsKoreanStockNamesBatch } = await import(
      "./us-naver-korean-name.js"
    );
    const missing = holdings
      .filter((h) => !h.nameKo)
      .map((h) => h.symbol)
      .slice(0, 20);
    if (missing.length) {
      const map = await resolveUsKoreanStockNamesBatch(missing, 6);
      for (const h of holdings) {
        if (h.nameKo) continue;
        const ko = map.get(h.symbol);
        if (ko && hasHangul(ko)) h.nameKo = ko;
      }
    }
  } catch {
    /* ignore */
  }

  const allocation = {
    stock: yahooPct(th.stockPosition),
    bond: yahooPct(th.bondPosition),
    cash: yahooPct(th.cashPosition),
    other: yahooPct(th.otherPosition),
    preferred: yahooPct(th.preferredPosition),
    convertible: yahooPct(th.convertiblePosition),
  };

  const family = String(fund.family ?? "").trim() || null;
  const category = String(fund.categoryName ?? "").trim() || null;
  const etfName =
    String(price.longName ?? price.shortName ?? "").trim() || sym;

  /** @type {string | null} */
  let note = null;
  if (holdings.length === 0) {
    note =
      "이 ETF는 Yahoo에서 개별 보유 종목 목록을 제공하지 않습니다(채권형·파생 중심 등). 자산·자산 배분은 아래를 참고하세요.";
  } else if (holdings.length <= 3) {
    note =
      "레버리지·인버스 등 일부 ETF는 파생·현금성 비중이 커 상위 보유 종목이 적게 표시될 수 있습니다.";
  } else {
    note =
      "Yahoo Finance 상위 보유 종목 기준입니다. 전체 포트폴리오의 일부만 표시될 수 있습니다.";
  }

  const payload = {
    symbol: sym,
    name: etfName,
    family,
    category,
    holdings,
    sectors: parseSectorWeightings(th.sectorWeightings),
    allocation,
    updatedAt: now,
    source: "yahoo-topHoldings",
    note,
  };
  holdingsCache.set(sym, { data: payload, at: now });
  return payload;
}
