/**
 * 미국 주요 거래소 ETF 목록 (Yahoo screener + 네이버 한글명·설명).
 * 나스닥(NMS/NGM/…) + Cboe BZX(BTS) + NYSE Arca(PCX) — DRAM/RAM 등 Cboe 상장 ETF 포함.
 */
import { getKoreanStockName, hasHangul, resolveDisplayName } from "./names-ko.js";
import { getYahooSession, yahooGet, yahooPost } from "./yahoo.js";

/** Nasdaq + Cboe US(BTS) + NYSE Arca(PCX) — Yahoo screener exchange 코드 */
const US_ETF_EXCHANGES = ["NMS", "NGM", "NAS", "NCM", "BTS", "PCX"];
/** @deprecated 호환용 별칭 */
const NASDAQ_ETF_EXCHANGES = US_ETF_EXCHANGES;

/** 거래소당 스크리너 상한 — 신규·소형 ETF가 AUM 하위권에 있어도 포함 */
const PER_EXCHANGE_MAX = (() => {
  const n = Number(process.env.STOCK_NASDAQ_ETF_PER_EX ?? 3000);
  return Number.isFinite(n) && n >= 500 ? Math.min(n, 5000) : 3000;
})();

const TARGET = (() => {
  const n = Number(process.env.STOCK_NASDAQ_ETF_TARGET ?? 8000);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 12_000) : 8000;
})();

/**
 * Yahoo가 quoteType=EQUITY로 잘못 태깅하거나 AUM 하위·신규 상장이라 스크리너에 빠진 ETF 보강.
 * (예: IQQ, Roundhill Memory DRAM / 2x RAM — Cboe BZX)
 */
const SUPPLEMENTAL_ETF_SYMBOLS = [
  "IQQ",
  "IQQQ",
  "QQQM",
  "QQQ",
  "TQQQ",
  "SQQQ",
  "QYLD",
  "QQQI",
  "DRAM",
  "RAM",
  "SMH",
  "SOXX",
  "SOXL",
  "SOXS",
  "USD",
  "SEMI",
];

/** 검색으로 놓친 티커를 더 끌어오기 */
const SUPPLEMENTAL_SEARCH_QUERIES = [
  "iShares Nasdaq 100 ETF",
  "Roundhill Memory ETF",
  "Roundhill DRAM",
  "2X Long DRAM",
  "VanEck Semiconductor ETF",
];


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
/** @type {Promise<object> | null} */
let inflightPayload = null;
/** @type {number} */
let buildGeneration = 0;
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
 * @param {number} maxCount
 * @param {(batch: object[]) => void | Promise<void>} [onBatch]
 */
async function fetchExchangeEtfUniverse(region, exchange, maxCount, onBatch) {
  const out = [];
  const seen = new Set();
  const ex = String(exchange ?? "").trim();
  if (!ex) return [];
  const cap = Math.max(500, Number(maxCount) || PER_EXCHANGE_MAX);

  for (let offset = 0; offset < Math.max(cap * 2, 8_000) && out.length < cap; offset += 250) {
    try {
      const page = await fetchEtfScreenerPage(region, offset, 250, ex);
      /** @type {object[]} */
      const fresh = [];
      for (const item of page) {
        if (!seen.has(item.symbol)) {
          seen.add(item.symbol);
          out.push(item);
          fresh.push(item);
        }
      }
      if (fresh.length > 0 && typeof onBatch === "function") {
        await onBatch(fresh);
      }
      // 페이지가 비면 종료. 짧아도 offset을 더 밀어 AUM 하위·신규 티커를 놓치지 않음
      if (page.length === 0) break;
      if (page.length < 25 && offset >= 1500) break;
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

/**
 * @param {string} symbol
 * @returns {Promise<object | null>}
 */
async function fetchQuoteAsUsEtfRow(symbol) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return null;
  try {
    const data = await yahooGet(
      `/v7/finance/quote?symbols=${encodeURIComponent(sym)}`,
    );
    const r = data?.quoteResponse?.result?.[0];
    if (!r) return null;
    const exchange = String(r.exchange ?? "").trim().toUpperCase();
    if (!US_ETF_EXCHANGES.includes(exchange)) return null;
    const name = resolveDisplayName(sym, r.shortName, r.longName);
    const qt = String(r.quoteType ?? "").toUpperCase();
    const looksEtf =
      qt === "ETF" ||
      /ETF|UCITS|Trust|Fund\b/i.test(String(r.shortName ?? "")) ||
      /ETF|UCITS|Trust|Fund\b/i.test(String(r.longName ?? ""));
    if (!looksEtf) return null;
    const priceRaw = r.regularMarketPrice;
    const changeRaw = r.regularMarketChangePercent;
    return {
      symbol: sym,
      name,
      nameKo: null,
      description: null,
      categoryKo: null,
      exchange,
      exchangeDisp: String(r.fullExchangeName ?? "").trim() || null,
      price:
        typeof priceRaw === "number" && Number.isFinite(priceRaw)
          ? priceRaw
          : null,
      changePercent:
        typeof changeRaw === "number" && Number.isFinite(changeRaw)
          ? changeRaw
          : null,
      netAssets: null,
    };
  } catch {
    return null;
  }
}

/** @deprecated 별칭 */
const fetchQuoteAsNasdaqEtfRow = fetchQuoteAsUsEtfRow;

/**
 * @param {Map<string, object>} bySym
 */
async function mergeSupplementalEtfs(bySym) {
  /** @type {string[]} */
  const missing = SUPPLEMENTAL_ETF_SYMBOLS.filter((s) => !bySym.has(s));
  for (const q of SUPPLEMENTAL_SEARCH_QUERIES) {
    try {
      const data = await yahooGet(
        `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=20&newsCount=0`,
      );
      for (const row of data?.quotes ?? []) {
        const sym = String(row.symbol ?? "").trim().toUpperCase();
        if (!sym || bySym.has(sym) || missing.includes(sym)) continue;
        if (
          String(row.quoteType ?? "").toUpperCase() === "ETF" ||
          /ETF/i.test(String(row.shortname ?? row.longname ?? ""))
        ) {
          missing.push(sym);
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const sym of missing) {
    if (bySym.has(sym)) continue;
    const row = await fetchQuoteAsUsEtfRow(sym);
    if (row) bySym.set(sym, row);
  }
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
 * @param {string} englishName
 * @param {string} symbol
 */
function fallbackDescriptionKo(englishName, symbol) {
  const text = `${englishName} ${symbol}`;
  if (/NASDAQ[-\s]?100|Nasdaq[-\s]?100|QQQ\b/i.test(text) || ["IQQ", "QQQ", "QQQM", "TQQQ", "SQQQ", "QQQI"].includes(symbol)) {
    return "나스닥100(Nasdaq-100) 지수를 추종하거나 관련 전략을 쓰는 ETF입니다. 나스닥에 상장된 비금융 대형·성장주 비중이 높습니다.";
  }
  if (/S&P\s*500|SPDR S&P|IVV|VOO|SPY/i.test(text) || ["SPY", "IVV", "VOO", "SPL"].includes(symbol)) {
    return "S&P500 지수를 추종하는 ETF로, 미국 대형주 시장 전반에 분산 투자합니다.";
  }
  if (/bond|treasury|agg|채권|고정수익/i.test(text) || /\bBND\b|\bTLT\b|\bIEF\b/i.test(text)) {
    return "채권·고정수익에 투자하는 ETF입니다. 금리·신용 환경에 따라 가격이 변동할 수 있습니다.";
  }
  if (/3x|ultra|leveraged|bull|2x/i.test(text)) {
    return "레버리지 ETF로, 기초 지수·자산의 일일 수익률을 배수로 추종합니다. 장기 보유 시 복리 효과로 성과가 달라질 수 있습니다.";
  }
  if (/short|bear|inverse|-1x|-2x|-3x/i.test(text)) {
    return "인버스(하락 추종) ETF로, 기초 자산과 반대 방향의 일일 성과를 목표로 합니다. 단기 헤지 성격이 강합니다.";
  }
  if (/semiconductor|SOX|chip|memory|DRAM|NAND|HBM/i.test(text) || ["SOXL", "SOXS", "SMH", "SOXX", "DRAM", "RAM", "SEMI", "USD"].includes(symbol)) {
    return "반도체·메모리(DRAM·NAND·HBM 등) 관련 기업에 집중 투자하는 ETF입니다.";
  }
  if (/gold|silver|metal|commodity|원유|oil/i.test(text)) {
    return "원자재·상품 관련 ETF입니다. 현물·선물·관련 기업 등으로 구성될 수 있습니다.";
  }
  if (/dividend|income|yield|배당/i.test(text)) {
    return "배당·인컴 전략을 쓰는 ETF입니다. 배당 수익률과 자본 이득을 함께 추구합니다.";
  }
  if (/growth|value|momentum|factor/i.test(text)) {
    return "특정 팩터(성장·가치·모멘텀 등)를 반영하는 주식형 ETF입니다.";
  }
  let label = String(englishName || symbol).trim() || symbol;
  if (!hasHangul(label)) {
    for (const [re, koBrand] of BRAND_KO) {
      if (re.test(label)) {
        label = label.replace(re, koBrand);
        break;
      }
    }
  }
  if (hasHangul(label)) {
    return `${label}(${symbol})에 투자하는 미국 상장 ETF입니다. 세부 구성·전략은 발행사 자료를 참고하세요.`;
  }
  return `${symbol}에 투자하는 미국 상장 ETF입니다. 세부 구성·전략은 발행사 자료를 참고하세요.`;
}

/**
 * @param {Array<object>} etfs
 */
async function enrichKoreanMetaFast(etfs) {
  const pinion = await loadPinionKoByTicker();
  for (const row of etfs) {
    const sym = row.symbol;
    const pinionKo = pinion.get(sym) ?? pinion.get(sym.replace(/-/g, "."));
    if (pinionKo && hasHangul(pinionKo)) {
      row.nameKo = pinionKo;
    } else if (!row.nameKo || !hasHangul(row.nameKo)) {
      const quick = buildNameKo(row.name || "", sym, null);
      if (quick && hasHangul(quick)) row.nameKo = quick;
    }
    if (!row.description || !hasHangul(row.description)) {
      row.description = fallbackDescriptionKo(
        row.nameKo || row.name || "",
        sym,
      );
    }
    if (!row.nameKo || !hasHangul(row.nameKo)) {
      const built = buildNameKo(row.name || "", sym, null);
      if (built) row.nameKo = built;
    }
  }
}

/**
 * 네이버 상세 보강 — 상위 AUM + 강제 포함 티커만 (느림, 백그라운드)
 * @param {Array<object>} etfs
 * @param {number} concurrency
 */
async function enrichKoreanMetaNaver(etfs, concurrency = 10) {
  const supplemental = new Set(SUPPLEMENTAL_ETF_SYMBOLS);
  const ranked = [...etfs].sort((a, b) => {
    const an = a.netAssets;
    const bn = b.netAssets;
    if (an != null && bn != null && an !== bn) return bn - an;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return 0;
  });
  /** @type {Set<object>} */
  const enrichSet = new Set(ranked.slice(0, NAVER_ENRICH_CAP));
  for (const row of etfs) {
    if (supplemental.has(row.symbol)) enrichSet.add(row);
  }
  const needNaver = [...enrichSet].filter((r) => !r.categoryKo);
  const limit = Math.max(1, Math.min(concurrency, 12));

  for (let i = 0; i < needNaver.length; i += limit) {
    const chunk = needNaver.slice(i, i + limit);
    await Promise.all(
      chunk.map(async (row) => {
        const naver = await fetchNaverEtfMeta(row.symbol);
        if (!naver) return;
        if (!row.nameKo || !hasHangul(row.nameKo)) {
          const built = buildNameKo(row.name || "", row.symbol, naver);
          if (built && hasHangul(built)) row.nameKo = built;
        }
        if (naver.tip && hasHangul(naver.tip)) row.description = naver.tip;

        const cat = [naver.large, naver.middle].filter(Boolean).join(" · ");
        if (cat) row.categoryKo = cat;
      }),
    );
  }
}

/** 네이버/야후 상세 보강 상한 */
const NAVER_ENRICH_CAP = (() => {
  const n = Number(process.env.STOCK_NASDAQ_ETF_NAVER_ENRICH ?? 900);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 2500) : 900;
})();

/**
 * @param {Array<object>} etfs
 */
function sortEtfsByAum(etfs) {
  return [...etfs].sort((a, b) => {
    const an = a.netAssets;
    const bn = b.netAssets;
    if (an != null && bn != null && an !== bn) return bn - an;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return String(a.symbol).localeCompare(String(b.symbol));
  });
}

/**
 * @param {Map<string, object>} bySym
 * @param {{ building: boolean; enriching: boolean }} flags
 */
function publishEtfSnapshot(bySym, flags) {
  let etfs = sortEtfsByAum([...bySym.values()]);
  if (etfs.length > TARGET) etfs = etfs.slice(0, TARGET);
  const data = {
    etfs,
    count: etfs.length,
    updatedAt: Date.now(),
    source: "yahoo-screener-etf-us-nasdaq-cboe-arca+naver",
    building: Boolean(flags.building),
    enriching: Boolean(flags.enriching),
  };
  cached = { data, at: Date.now() };
  return data;
}

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{
 *   etfs: Array<object>;
 *   count: number;
 *   updatedAt: number;
 *   source: string;
 *   building?: boolean;
 *   enriching?: boolean;
 * }>}
 */
export async function fetchNasdaqEtfsPayload(opts = {}) {
  const force = Boolean(opts.force);
  const now = Date.now();
  if (
    !force &&
    cached &&
    now - cached.at < CACHE_MS &&
    !cached.data.building &&
    !cached.data.enriching
  ) {
    return cached.data;
  }
  /** 빌드/보강 중이면 최신 스냅샷을 즉시 반환(클라가 폴링으로 이어받음) */
  if (
    !force &&
    cached?.data &&
    (cached.data.building || cached.data.enriching) &&
    Array.isArray(cached.data.etfs) &&
    cached.data.etfs.length > 0
  ) {
    return cached.data;
  }
  if (!force && inflightPayload) {
    if (
      cached?.data &&
      Array.isArray(cached.data.etfs) &&
      cached.data.etfs.length > 0
    ) {
      return cached.data;
    }
    return inflightPayload;
  }

  if (force) {
    cached = null;
  }

  let resolveFirst = /** @type {(() => void) | null} */ (null);
  const firstSnapshotReady = new Promise((resolve) => {
    resolveFirst = () => resolve(undefined);
  });
  let firstReleased = false;

  const releaseFirst = () => {
    if (firstReleased) return;
    firstReleased = true;
    resolveFirst?.();
  };

  const buildGen = ++buildGeneration;

  inflightPayload = (async () => {
    await getYahooSession();
    /** @type {Map<string, object>} */
    const bySym = new Map();

    await Promise.all(
      US_ETF_EXCHANGES.map(async (ex) => {
        try {
          await fetchExchangeEtfUniverse(
            "us",
            ex,
            PER_EXCHANGE_MAX,
            async (fresh) => {
              if (buildGen !== buildGeneration) return;
              let added = 0;
              for (const row of fresh) {
                if (!bySym.has(row.symbol)) {
                  bySym.set(row.symbol, row);
                  added += 1;
                }
              }
              if (added <= 0) return;
              await enrichKoreanMetaFast(fresh);
              if (buildGen !== buildGeneration) return;
              publishEtfSnapshot(bySym, { building: true, enriching: true });
              releaseFirst();
            },
          );
        } catch (e) {
          console.warn(
            "[nasdaq-etf] exchange",
            ex,
            e instanceof Error ? e.message : e,
          );
        }
      }),
    );

    if (buildGen !== buildGeneration) {
      return (
        cached?.data ?? {
          etfs: [],
          count: 0,
          updatedAt: Date.now(),
          source: "stale",
        }
      );
    }

    try {
      await mergeSupplementalEtfs(bySym);
    } catch (e) {
      console.warn(
        "[nasdaq-etf] supplemental:",
        e instanceof Error ? e.message : e,
      );
    }

    await enrichKoreanMetaFast([...bySym.values()]);
    if (buildGen !== buildGeneration) {
      return (
        cached?.data ?? {
          etfs: [],
          count: 0,
          updatedAt: Date.now(),
          source: "stale",
        }
      );
    }
    publishEtfSnapshot(bySym, { building: false, enriching: true });
    releaseFirst();

    try {
      let etfs = sortEtfsByAum([...bySym.values()]);
      if (etfs.length > TARGET) etfs = etfs.slice(0, TARGET);
      await enrichKoreanMetaNaver(etfs);
    } catch (e) {
      console.warn(
        "[nasdaq-etf] korean enrich:",
        e instanceof Error ? e.message : e,
      );
    }

    if (buildGen !== buildGeneration) {
      return (
        cached?.data ?? {
          etfs: [],
          count: 0,
          updatedAt: Date.now(),
          source: "stale",
        }
      );
    }
    return publishEtfSnapshot(bySym, { building: false, enriching: false });
  })().finally(() => {
    if (buildGen === buildGeneration) {
      inflightPayload = null;
    }
  });

  await Promise.race([
    firstSnapshotReady,
    inflightPayload,
    new Promise((r) => setTimeout(r, 12_000)),
  ]);
  if (cached?.data) return cached.data;
  return inflightPayload;
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
 * @param {unknown} th
 */
function mapYahooHoldings(th) {
  const rawHoldings = Array.isArray(th?.holdings) ? th.holdings : [];
  return rawHoldings
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
}

/**
 * 나스닥100 추종 ETF — Yahoo가 보유목록을 아직 안 줄 때 QQQ로 참고 구성
 * @param {string} symbol
 * @param {string} etfName
 */
function isNasdaq100Tracker(symbol, etfName) {
  const sym = String(symbol ?? "").toUpperCase();
  if (["IQQ", "QQQ", "QQQM", "QQQI", "QTOP", "QNXT"].includes(sym)) return true;
  return /NASDAQ[-\s]?100|Nasdaq[-\s]?100/i.test(String(etfName ?? ""));
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
      name: "",
      description: null,
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
    `/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=topHoldings,fundProfile,assetProfile,price`,
  );
  const row = data?.quoteSummary?.result?.[0] ?? {};
  let th = row.topHoldings ?? {};
  const price = row.price ?? {};
  const fund = row.fundProfile ?? {};

  let holdings = mapYahooHoldings(th);
  let sectors = parseSectorWeightings(th.sectorWeightings);
  let allocation = {
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
  let proxyOf = null;
  if (holdings.length === 0 && isNasdaq100Tracker(sym, etfName) && sym !== "QQQ") {
    try {
      const proxyData = await yahooGet(
        `/v10/finance/quoteSummary/QQQ?modules=topHoldings`,
      );
      const pTh = proxyData?.quoteSummary?.result?.[0]?.topHoldings ?? {};
      const proxyHoldings = mapYahooHoldings(pTh);
      if (proxyHoldings.length) {
        holdings = proxyHoldings;
        if (!sectors.length) sectors = parseSectorWeightings(pTh.sectorWeightings);
        if (allocation.stock == null && allocation.bond == null) {
          allocation = {
            stock: yahooPct(pTh.stockPosition),
            bond: yahooPct(pTh.bondPosition),
            cash: yahooPct(pTh.cashPosition),
            other: yahooPct(pTh.otherPosition),
            preferred: yahooPct(pTh.preferredPosition),
            convertible: yahooPct(pTh.convertiblePosition),
          };
        }
        proxyOf = "QQQ";
        th = pTh;
      }
    } catch {
      /* ignore */
    }
  }

  // 보유 종목 한글명 보강
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

  /** @type {string | null} */
  let description = null;
  try {
    const naver = await fetchNaverEtfMeta(sym);
    if (naver?.tip && hasHangul(naver.tip)) description = naver.tip;
  } catch {
    /* ignore */
  }
  if (!description || !hasHangul(description)) {
    description = fallbackDescriptionKo(etfName, sym);
  }

  const holdingsWeightSum = holdings.reduce(
    (s, h) =>
      s +
      (typeof h.weight === "number" && Number.isFinite(h.weight) ? h.weight : 0),
    0,
  );

  /** @type {string | null} */
  let note = null;
  if (proxyOf) {
    note =
      `${sym}은(는) Yahoo에 개별 보유 목록이 아직 없습니다. 동일하게 나스닥100을 추종하는 ${proxyOf}의 상위 보유를 참고용으로 표시합니다. 실제 비중은 운용사 공시와 다를 수 있습니다.`;
  } else if (holdings.length === 0) {
    note =
      "이 ETF는 Yahoo에서 개별 보유 종목 목록을 제공하지 않습니다(채권형·파생 중심·신규 상장 등). 설명이 있으면 위를 참고하세요.";
  } else if (holdings.length <= 3) {
    note =
      "레버리지·인버스 등 일부 ETF는 파생·현금성 비중이 커 상위 보유 종목이 적게 표시될 수 있습니다. Yahoo는 전체 종목이 아니라 상위 보유만 제공합니다.";
  } else {
    note =
      "Yahoo Finance는 ETF 전체 종목이 아니라 상위 보유(보통 10개)만 제공합니다. 아래 합계가 100%가 아닌 것은 나머지 수백~수천 종목이 ‘기타(미표시)’로 묶여 있기 때문입니다.";
  }

  const payload = {
    symbol: sym,
    name: etfName,
    description,
    family,
    category,
    holdings,
    holdingsWeightSum,
    holdingsOtherWeight: Math.max(0, 1 - holdingsWeightSum),
    sectors,
    allocation,
    proxyOf,
    updatedAt: now,
    source: proxyOf ? `yahoo-topHoldings-proxy:${proxyOf}` : "yahoo-topHoldings",
    note,
  };
  holdingsCache.set(sym, { data: payload, at: now });
  return payload;
}
