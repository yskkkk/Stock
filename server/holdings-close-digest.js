/**
 * 장 마감 보유 종목 브리핑 — 시세·뉴스 톤·주가 영향·시장 흐름
 */
import { getKstParts, isKrBusinessDay } from "./kr-business-day.js";
import { getTradingSessionKey } from "./market-hours.js";
import { collectUserHeldSymbolsAsync } from "./holdings-news-symbols.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { loadNews } from "./news.js";
import { getMarketIndices } from "./market-indices.js";
import {
  buildHoldingsNewsBrief,
  formatNewsPublishedKo,
} from "./holdings-news-brief.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

/** 정규장 종료 후 시세 안정 대기(분) — KR 15:30, US 16:00 이후 */
const KR_DIGEST_AFTER_MIN = 15 * 60 + 40;
const US_DIGEST_AFTER_MIN = 16 * 60 + 10;

export const HOLDINGS_CLOSE_NEWS_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const HOLDINGS_CLOSE_NEWS_PER_SYMBOL = 5;
export const HOLDINGS_CLOSE_MAX_SYMBOLS = 40;

/**
 * @param {Date} [now]
 */
function localParts(market, now = new Date()) {
  const tz = market === "kr" ? "Asia/Seoul" : "America/New_York";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/**
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function getHoldingsCloseSessionKey(market, now = new Date()) {
  return getTradingSessionKey(market, now);
}

/**
 * 해당 시장 정규장이 끝나고 브리핑을 보내도 되는 시각인지.
 * @param {"kr"|"us"} market
 * @param {Date} [now]
 */
export function isHoldingsCloseDigestDue(market, now = new Date()) {
  if (market === "kr") {
    const kst = getKstParts(now);
    if (!isKrBusinessDay(kst.dateKey)) return false;
    return kst.minutesOfDay >= KR_DIGEST_AFTER_MIN;
  }
  const { weekday, minutes } = localParts("us", now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= US_DIGEST_AFTER_MIN;
}

/**
 * @param {number | null | undefined} n
 */
export function formatSignedPct(n) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v).toFixed(2);
  return v > 0 ? `+${abs}%` : v < 0 ? `-${abs}%` : "0.00%";
}

/**
 * @param {number | null | undefined} price
 * @param {string | undefined} currency
 * @param {"kr"|"us"} [market]
 */
export function formatHoldingPrice(price, currency, market = "us") {
  const p = Number(price);
  if (!Number.isFinite(p)) return "—";
  const cur = String(currency ?? "").toUpperCase();
  if (market === "kr" || cur === "KRW") {
    return `${Math.round(p).toLocaleString("ko-KR")}원`;
  }
  return `$${p.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 뉴스 톤과 당일 등락을 맞춰 「어떤 영향으로 보이는지」 한 줄.
 * 인과를 단정하지 않고 방향 일치/불일치만 적습니다.
 * @param {{
 *   sentiment?: "positive"|"negative"|"neutral"|string;
 *   changePercent?: number | null;
 * }} args
 */
export function describeNewsPriceImpact(args = {}) {
  const sentiment = args.sentiment;
  const pct = Number(args.changePercent);
  const hasPct = Number.isFinite(pct);
  const up = hasPct && pct > 0.15;
  const down = hasPct && pct < -0.15;
  const pctLabel = hasPct ? formatSignedPct(pct) : "등락 미확인";

  if (!hasPct) {
    return "당일 등락을 확인하지 못해, 주가 영향은 원문과 시세를 함께 보세요.";
  }
  if (sentiment === "positive" && up) {
    return `당일 ${pctLabel} 상승 — 호재와 같은 방향으로 움직였습니다.`;
  }
  if (sentiment === "positive" && down) {
    return `당일 ${pctLabel} 하락 — 호재로 분류됐지만 주가는 내렸습니다. 이미 반영됐거나 다른 악재·차익실현 가능성을 같이 보세요.`;
  }
  if (sentiment === "negative" && down) {
    return `당일 ${pctLabel} 하락 — 악재와 같은 방향으로 움직였습니다.`;
  }
  if (sentiment === "negative" && up) {
    return `당일 ${pctLabel} 상승 — 악재로 분류됐지만 주가는 올랐습니다. 이미 소화됐거나 다른 호재가 있을 수 있습니다.`;
  }
  if (sentiment === "neutral") {
    return `당일 ${pctLabel}. 뉴스 방향이 뚜렷하지 않아 등락과의 연결은 참고만 하세요.`;
  }
  if (up) {
    return `당일 ${pctLabel} 상승. 뉴스 톤과 주가 방향의 연결은 제한적입니다.`;
  }
  if (down) {
    return `당일 ${pctLabel} 하락. 뉴스 톤과 주가 방향의 연결은 제한적입니다.`;
  }
  return `당일 ${pctLabel}로 보합권입니다. 뉴스와 주가의 연결은 제한적입니다.`;
}

/**
 * @param {{ id?: string; label?: string; changePercent?: number | null; price?: number | null; kind?: string; region?: string }[]} items
 * @param {"kr"|"us"|"all"} [focus]
 */
export function buildMarketFlowText(items, focus = "all") {
  const rows = Array.isArray(items) ? items : [];
  const pick = (id) => rows.find((r) => r.id === id);

  /** @param {typeof rows[0] | undefined} row */
  const line = (row) => {
    if (!row) return "";
    const pct = formatSignedPct(row.changePercent);
    if (row.kind === "fx" && Number.isFinite(Number(row.price))) {
      return `${row.label} ${Number(row.price).toLocaleString("ko-KR", {
        maximumFractionDigits: 2,
      })}원 (${pct})`;
    }
    return `${row.label} ${pct}`;
  };

  const kospi = pick("kospi");
  const kosdaq = pick("kosdaq");
  const nasdaq = pick("nasdaq");
  const sp = pick("sp500");
  const dow = pick("dow");
  const fx = pick("usdkrw");

  /** @type {string[]} */
  const parts = [];
  const krBits = [line(kospi), line(kosdaq)].filter(Boolean);
  const usBits = [line(nasdaq), line(sp), line(dow)].filter(Boolean);
  if (krBits.length) parts.push(`국내: ${krBits.join(", ")}.`);
  if (usBits.length) parts.push(`미국: ${usBits.join(", ")}.`);
  const fxLine = line(fx);
  if (fxLine) parts.push(fxLine + ".");

  const focusRow = focus === "kr" ? kospi : focus === "us" ? nasdaq : kospi || nasdaq;
  const chg = Number(focusRow?.changePercent);
  if (Number.isFinite(chg)) {
    if (focus === "kr" || focus === "all") {
      if (chg > 0.3) parts.push("국내 증시는 상승 마감 흐름입니다.");
      else if (chg < -0.3) parts.push("국내 증시는 하락 마감 흐름입니다.");
      else if (focus === "kr") parts.push("국내 증시는 보합권에서 마감하는 흐름입니다.");
    }
    if (focus === "us") {
      const usChg = Number(nasdaq?.changePercent);
      if (Number.isFinite(usChg)) {
        if (usChg > 0.3) parts.push("미국 증시는 상승 마감 흐름입니다.");
        else if (usChg < -0.3) parts.push("미국 증시는 하락 마감 흐름입니다.");
        else parts.push("미국 증시는 보합권에서 마감하는 흐름입니다.");
      }
    }
  }

  return parts.join(" ").trim() || "지수 시세를 아직 확인하지 못했습니다.";
}

/**
 * @param {unknown[]} items
 * @param {{ sinceMs: number; limit?: number }} opts
 */
export function pickSessionNewsItems(items, opts) {
  const sinceMs = Number(opts.sinceMs) || 0;
  const limit = Math.max(1, Number(opts.limit) || HOLDINGS_CLOSE_NEWS_PER_SYMBOL);
  return (Array.isArray(items) ? items : [])
    .filter((it) => {
      const t = Number(it?.publishedAt);
      if (!Number.isFinite(t) || t <= 0) return false;
      return t >= sinceMs;
    })
    .sort((a, b) => Number(b.publishedAt) - Number(a.publishedAt))
    .slice(0, limit);
}

/**
 * @param {string} [raw]
 */
export function listHoldingsCloseDigestRecipientEmailsSync(raw) {
  const allMembers =
    String(process.env.STOCK_HOLDINGS_CLOSE_DIGEST_ALL_MEMBERS ?? "0").trim() ===
    "1";
  if (allMembers) return [];
  const src = String(
    raw ??
      process.env.STOCK_HOLDINGS_CLOSE_DIGEST_TO ??
      process.env.AGENT_EMAIL_TO ??
      "samron3@naver.com",
  ).trim();
  return [
    ...new Set(
      src
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes("@")),
    ),
  ];
}

export function holdingsCloseDigestEnabled() {
  return String(process.env.STOCK_HOLDINGS_CLOSE_DIGEST ?? "1").trim() !== "0";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isDigestEquitySymbol(symbol, market) {
  if (market === "crypto") return false;
  const s = String(symbol ?? "").trim().toUpperCase();
  if (!s) return false;
  if (s.includes("-USDT") || s.endsWith("USDT") || s.endsWith("-USD")) return false;
  return true;
}

/**
 * @param {{
 *   userId: string;
 *   market: "kr"|"us"|"all";
 *   now?: Date;
 * }} opts
 */
export async function buildHoldingsCloseDigest(opts) {
  const userId = String(opts.userId ?? "").trim();
  const market = opts.market === "kr" || opts.market === "us" ? opts.market : "all";
  const now = opts.now instanceof Date ? opts.now : new Date();
  const nowMs = now.getTime();
  const sinceMs = nowMs - HOLDINGS_CLOSE_NEWS_LOOKBACK_MS;
  const sessionKey =
    market === "all"
      ? `all:${getHoldingsCloseSessionKey("kr", now)}+${getHoldingsCloseSessionKey("us", now)}`
      : getHoldingsCloseSessionKey(market, now);

  const held = userId ? await collectUserHeldSymbolsAsync(userId) : [];
  const filtered = (
    market === "all" ? held : held.filter((h) => h.market === market)
  ).filter((h) => isDigestEquitySymbol(h.symbol, h.market));
  const symbols = filtered.slice(0, HOLDINGS_CLOSE_MAX_SYMBOLS);

  const krSyms = symbols.filter((h) => h.market === "kr").map((h) => h.symbol);
  const usSyms = symbols.filter((h) => h.market === "us").map((h) => h.symbol);
  /** @type {Record<string, { price: number; changePercent?: number; currency?: string }>} */
  let quotes = {};
  try {
    const [krQ, usQ] = await Promise.all([
      krSyms.length
        ? fetchQuoteSnapshotsForSymbols(krSyms, { maxAgeMs: 0, market: "kr" })
        : {},
      usSyms.length
        ? fetchQuoteSnapshotsForSymbols(usSyms, { maxAgeMs: 0, market: "us" })
        : {},
    ]);
    quotes = { ...krQ, ...usQ };
  } catch (e) {
    liveTradeLogWarn(
      "[holdings-close-digest] quotes failed",
      e instanceof Error ? e.message : e,
    );
  }

  let indices = { items: [], updatedAt: nowMs };
  try {
    indices = await getMarketIndices();
  } catch (e) {
    liveTradeLogWarn(
      "[holdings-close-digest] indices failed",
      e instanceof Error ? e.message : e,
    );
  }

  const marketFlow = buildMarketFlowText(indices.items ?? [], market);

  /** @type {Array<{
   *   symbol: string;
   *   name: string;
   *   market: "kr"|"us";
   *   priceLabel: string;
   *   changeLabel: string;
   *   changePercent: number | null;
   *   news: Array<{
   *     title: string;
   *     url: string;
   *     source: string;
   *     publishedLabel: string;
   *     labelKo: string;
   *     sentiment: string;
   *     impact: string;
   *   }>;
   * }>} */
  const rows = [];

  for (const h of symbols) {
    const q = quotes[h.symbol] ?? quotes[h.symbol.replace(/\.(KS|KQ)$/i, "")];
    const changePercent =
      q?.changePercent != null && Number.isFinite(Number(q.changePercent))
        ? Number(q.changePercent)
        : null;
    /** @type {typeof rows[0]["news"]} */
    const newsOut = [];
    try {
      const pack = await loadNews(h.symbol, h.name, { bypassCache: true });
      const picked = pickSessionNewsItems(pack?.items ?? [], {
        sinceMs,
        limit: HOLDINGS_CLOSE_NEWS_PER_SYMBOL,
      });
      for (const item of picked) {
        const brief = buildHoldingsNewsBrief(item, h);
        newsOut.push({
          title: brief.headline,
          url: String(item?.url ?? "").trim(),
          source: String(item?.source ?? "").trim(),
          publishedLabel: formatNewsPublishedKo(item?.publishedAt),
          labelKo: brief.labelKo,
          sentiment: brief.sentiment,
          impact: describeNewsPriceImpact({
            sentiment: brief.sentiment,
            changePercent,
          }),
        });
      }
    } catch (e) {
      liveTradeLogWarn(
        "[holdings-close-digest] news failed",
        h.symbol,
        e instanceof Error ? e.message : e,
      );
    }
    rows.push({
      symbol: h.symbol,
      name: h.name,
      market: h.market,
      priceLabel: formatHoldingPrice(q?.price, q?.currency, h.market),
      changeLabel: formatSignedPct(changePercent),
      changePercent,
      news: newsOut,
    });
    await sleep(80);
  }

  const marketLabel =
    market === "kr" ? "국내" : market === "us" ? "미국" : "국내·미국";
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: market === "us" ? "America/New_York" : "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(now);

  return {
    userId,
    market,
    marketLabel,
    dateLabel,
    sessionKey,
    generatedAt: nowMs,
    marketFlow,
    indices: indices.items ?? [],
    rows,
    truncated: filtered.length > HOLDINGS_CLOSE_MAX_SYMBOLS,
  };
}
