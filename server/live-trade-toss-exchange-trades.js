/**
 * 토스증권 체결 — 거래내역 UI (GET /api/v1/orders?status=CLOSED)
 */
import { resolveDisplayName } from "./names-ko.js";
import {
  issueTossAccessToken,
  parseTossDecimal,
  parseTossOpenOrdersResult,
  resolveTossAccountSeq,
  fetchTossClosedOrdersPageRaw,
} from "./toss-openapi.js";
import { getOneWayFeeRateForUserMarketSync } from "./exchange-trading-fees.js";
import { liveTradeCurrency } from "./live-trade-market.js";
import { kstDateKeyFromMs } from "./live-trade-history.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

const HISTORY_LOOKBACK_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_PAGES = 50;

/**
 * @param {unknown} v
 */
function parseTossOrderSide(v) {
  const raw = String(v ?? "").trim().toUpperCase();
  if (raw === "SELL") return "sell";
  if (raw === "BUY") return "buy";
  return null;
}

/** CLOSED 주문 status — FILLED만 거래내역에 포함 */
function isTossFilledClosedOrder(o) {
  const st = String(o?.status ?? "").trim().toUpperCase();
  return st === "FILLED" || st === "PARTIALLY_FILLED";
}

/**
 * @param {unknown} o
 */
export function parseTossFilledOrderForHistory(o) {
  if (!isTossFilledClosedOrder(o)) return null;
  const orderId = String(o?.orderId ?? o?.id ?? "").trim();
  if (!orderId) return null;

  const side = parseTossOrderSide(o?.side);
  if (!side) return null;

  const rawSymbol = String(o?.symbol ?? "").trim();
  const marketCountry = String(o?.marketCountry ?? o?.market ?? "")
    .trim()
    .toUpperCase();
  const market =
    marketCountry === "US"
      ? "us"
      : marketCountry === "KR"
        ? "kr"
        : /^\d{6}$/.test(rawSymbol)
          ? "kr"
          : "us";
  const symbol =
    market === "kr" && /^\d{6}$/.test(rawSymbol) ? `${rawSymbol}.KS` : rawSymbol;
  if (!symbol) return null;

  const execution =
    o?.execution && typeof o.execution === "object" ? o.execution : null;
  const quantity = parseTossDecimal(execution?.filledQuantity);
  if (!(quantity > 0)) return null;

  const price = parseTossDecimal(execution?.averageFilledPrice);
  const filledAmount = parseTossDecimal(execution?.filledAmount);
  const feeAmount = parseTossDecimal(execution?.commission);
  const avgPrice =
    price > 0 ? price : filledAmount > 0 ? filledAmount / quantity : 0;
  if (!(avgPrice > 0)) return null;

  const amount = filledAmount > 0 ? filledAmount : avgPrice * quantity;
  const currencyRaw = String(o?.currency ?? (market === "us" ? "USD" : "KRW")).toUpperCase();
  const currency = currencyRaw === "USD" ? "USD" : "KRW";

  let atMs = Date.parse(String(execution?.filledAt ?? o?.orderedAt ?? ""));
  if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();

  return {
    orderId,
    side,
    symbol,
    name: resolveDisplayName(symbol, String(o?.name ?? rawSymbol).trim() || rawSymbol),
    market,
    quantity,
    price: avgPrice,
    amount,
    currency,
    feeAmount: feeAmount > 0 ? feeAmount : 0,
    atMs,
  };
}

/**
 * @param {string} accessToken
 * @param {string} accountSeq
 * @param {number} [sinceMs]
 */
export async function fetchAllTossClosedOrdersRaw(
  accessToken,
  accountSeq,
  sinceMs = Date.now() - HISTORY_LOOKBACK_MS,
) {
  const from = kstDateKeyFromMs(sinceMs);
  const to = kstDateKeyFromMs(Date.now());
  /** @type {object[]} */
  const all = [];
  let cursor = null;

  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    let batch;
    try {
      batch = await fetchTossClosedOrdersPageRaw(accessToken, accountSeq, {
        from,
        to,
        limit: 100,
        cursor: cursor ?? undefined,
      });
    } catch (e) {
      if (page === 0) throw e;
      liveTradeLogWarn(
        "[live-trade:toss-history]",
        "page failed",
        e instanceof Error ? e.message : e,
      );
      break;
    }

    const orders = Array.isArray(batch.orders) ? batch.orders : [];
    if (!orders.length) break;
    all.push(...orders);

    const last = orders[orders.length - 1];
    const lastMs = Date.parse(String(last?.orderedAt ?? last?.execution?.filledAt ?? ""));
    if (Number.isFinite(lastMs) && lastMs < sinceMs) break;
    if (!batch.hasNext || !batch.nextCursor) break;
    cursor = batch.nextCursor;
  }

  return all;
}

/**
 * @param {object[]} apiTrades
 * @param {object[]} storeTrades
 */
export function enrichTossApiHistoryTrades(apiTrades, storeTrades) {
  const byOrder = new Map();
  for (const t of storeTrades) {
    const oid = String(t.orderId ?? "").trim();
    if (oid) byOrder.set(oid, t);
  }
  return apiTrades.map((t) => {
    const s = byOrder.get(String(t.orderId ?? "").trim());
    if (!s) return t;
    return {
      ...t,
      entryPrice:
        t.entryPrice != null && Number.isFinite(t.entryPrice)
          ? t.entryPrice
          : s.entryPrice ?? null,
      programId: s.programId || t.programId,
      programName: s.programName || t.programName,
    };
  });
}

/**
 * @param {object[]} apiTrades
 * @param {object[]} storeTrades
 */
export function mergeTossApiAndStoreTrades(apiTrades, storeTrades) {
  const apiByOrder = new Set(
    apiTrades.map((t) => String(t.orderId ?? "").trim()).filter(Boolean),
  );
  const storeOnly = storeTrades.filter((t) => {
    const oid = String(t.orderId ?? "").trim();
    if (!oid) return true;
    return !apiByOrder.has(oid);
  });
  return [...apiTrades, ...storeOnly].sort((a, b) => b.atMs - a.atMs);
}

/**
 * 거래내역 UI — 토스 CLOSED 주문 API
 * @param {string} userId
 */
export async function listTossTradesFromExchangeApiForHistory(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];

  const credentials = getDecryptedCredentialsSync(uid, "toss");
  if (!credentials?.apiKey || !credentials?.secretKey) return [];

  const programs = listLiveTradeProgramsSync(uid);
  const program =
    programs.find((p) => p.markets?.kr || p.markets?.us) ?? programs[0] ?? null;
  const programId = program?.id ?? "toss-exchange";
  const programName = program?.name ?? "토스";

  const accessToken = await issueTossAccessToken(
    credentials.apiKey,
    credentials.secretKey,
  );
  const accountSeq = await resolveTossAccountSeq(accessToken, credentials.accountId);

  const sinceMs = Date.now() - HISTORY_LOOKBACK_MS;
  let rawOrders = [];
  try {
    rawOrders = await fetchAllTossClosedOrdersRaw(accessToken, accountSeq, sinceMs);
  } catch (e) {
    liveTradeLogWarn(
      "[live-trade:toss-history]",
      "closed orders fetch failed",
      e instanceof Error ? e.message : e,
    );
    return [];
  }

  const seenOrder = new Set();
  /** @type {object[]} */
  const out = [];

  for (const o of rawOrders) {
    const fill = parseTossFilledOrderForHistory(o);
    if (!fill || fill.atMs < sinceMs) continue;
    if (seenOrder.has(fill.orderId)) continue;
    seenOrder.add(fill.orderId);

    const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, fill.market);
    out.push({
      id: `toss:${fill.orderId}`,
      programId,
      programName,
      side: fill.side,
      symbol: fill.symbol,
      name: fill.name,
      market: fill.market,
      quantity: fill.quantity,
      price: fill.price,
      amount: fill.amount,
      currency: liveTradeCurrency(fill.market),
      feeAmount:
        fill.feeAmount > 0 ? fill.feeAmount : fill.amount * oneWayFee,
      simulated: false,
      orderId: fill.orderId,
      note: "토스 체결·API",
      exchangeImport: true,
      entryPrice: null,
      atMs: fill.atMs,
    });
  }

  return out.sort((a, b) => b.atMs - a.atMs);
}
