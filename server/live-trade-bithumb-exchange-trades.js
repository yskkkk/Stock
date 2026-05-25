/**
 * 빗썸 거래소 체결 — 텔레그램 첫 알림 이후만 포트폴리오 거래 내역에 병합
 */
import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";
import {
  fetchBithumbAccountsWithCredentials,
  listBithumbDoneOrdersWithCredentials,
} from "./bithumb-trading-adapter.js";
import { bithumbBaseToUsdtSymbol } from "./live-trade-bithumb-holdings.js";
import {
  getOneWayFeeRateForUserMarketSync,
  getRoundTripFeeRateForUserMarketSync,
} from "./exchange-trading-fees.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import { liveTradeCurrency } from "./live-trade-market.js";
import { netReturnPct } from "./net-return.js";
import {
  getEarliestTelegramNotifyAtMs,
  getTelegramNotifyBaseline,
} from "./telegram-notify.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { pickArmedProgramForSymbol } from "./live-trade-bithumb-holdings.js";
import {
  buildPositionsFromTrades,
  listLiveTradeRecordsSync,
  readStoreSync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import { liveTradeLogWarn } from "./live-trade-log.js";

/**
 * @param {object} order
 * @returns {{ price: number; volume: number; funds: number; atMs: number; orderId: string; side: "buy"|"sell" } | null}
 */
function parseDoneOrderFill(order) {
  const orderId = String(order?.uuid ?? order?.order_id ?? "").trim();
  const volume = Number(order?.executed_volume ?? 0);
  const funds = Number(order?.executed_funds ?? 0);
  if (!orderId || !Number.isFinite(volume) || volume <= 0) return null;
  const price =
    funds > 0 ? funds / volume : Number(order?.price ?? order?.avg_price ?? 0);
  if (!Number.isFinite(price) || price <= 0) return null;
  let atMs = Date.parse(String(order?.created_at ?? order?.createdAt ?? ""));
  if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();
  const sideRaw = String(order?.side ?? "").toLowerCase();
  const side = sideRaw === "ask" ? "sell" : sideRaw === "bid" ? "buy" : null;
  if (!side) return null;
  return { price, volume, funds, atMs, orderId, side };
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 * @param {string} symbol
 */
function resolveProgramForExchangeTrade(programs, symbol) {
  const armedCrypto = programs.filter(
    (p) =>
      p.status === "armed" &&
      (p.armedMarkets?.crypto || (p.markets?.crypto && !p.markets?.kr)),
  );
  const store = readStoreSync();
  const picked = pickArmedProgramForSymbol(armedCrypto, symbol, store);
  if (picked) return picked;
  const anyCrypto = programs.find((p) => p.markets?.crypto);
  return anyCrypto ?? null;
}

/**
 * @param {object} snap — buildLiveTradePortfolioSnapshot 결과
 * @param {string} userId
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
const LIVE_TRADE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

function isArmedCryptoProgram(p) {
  if (p.status !== "armed") return false;
  if (p.armedMarkets?.crypto) return true;
  return Boolean(p.markets?.crypto && !p.markets?.kr);
}

/**
 * @param {import("./bithumb-trading-adapter.js").BithumbCredentials} credentials
 * @param {object} snap
 */
async function collectLiveExchangeSymbols(credentials, snap) {
  /** @type {Set<string>} */
  const symbols = new Set();
  for (const h of snap.holdings ?? []) {
    if (h.market === "crypto") {
      symbols.add(String(h.symbol).trim().toUpperCase());
    }
  }
  for (const t of snap.trades ?? []) {
    if (t.market === "crypto") {
      symbols.add(String(t.symbol).trim().toUpperCase());
    }
  }
  try {
    const accounts = await fetchBithumbAccountsWithCredentials(credentials);
    for (const acc of accounts) {
      const sym = bithumbBaseToUsdtSymbol(String(acc.currency ?? ""));
      if (sym) symbols.add(sym);
    }
  } catch {
    /* ignore */
  }
  return symbols;
}

function liveTradeSinceMs(program) {
  const armed = program?.armedAtMs;
  if (typeof armed === "number" && Number.isFinite(armed) && armed > 0) {
    return armed;
  }
  return Date.now() - LIVE_TRADE_LOOKBACK_MS;
}

/**
 * 빗썸 체결 API — 프로그램 시작 이후·텔레그램 무관(가동 중 패널 실시간 동기화)
 * @param {object} snap
 * @param {string} userId
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
/**
 * 빗썸 체결 → server/.data/live-trade-portfolio.json (실매매 armed, 10초 동기화)
 * @param {string} userId
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
export async function persistBithumbExchangeTradesForUser(userId, programs) {
  const uid = String(userId ?? "").trim();
  if (!uid) return { sellsRecorded: 0, symbolsChecked: 0 };

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) {
    return { sellsRecorded: 0, symbolsChecked: 0 };
  }

  const armedCrypto = programs.filter(isArmedCryptoProgram);
  if (!armedCrypto.length) return { sellsRecorded: 0, symbolsChecked: 0 };

  const store = readStoreSync();
  const existingOrderIds = new Set(
    store.trades
      .map((t) => String(t.orderId ?? "").trim())
      .filter(Boolean),
  );

  const symbols = await collectLiveExchangeSymbols(credentials, {
    holdings: [],
    trades: store.trades,
  });

  let sellsRecorded = 0;

  for (const symbol of symbols) {
    const base = usdtSymbolToBithumbBase(symbol);
    if (!base) continue;
    const market = `KRW-${base}`;
    const program = resolveProgramForExchangeTrade(programs, symbol);
    if (!program || !isArmedCryptoProgram(program)) continue;

    const sinceMs = liveTradeSinceMs(program);
    let orders = [];
    try {
      orders = await listBithumbDoneOrdersWithCredentials(credentials, market, {
        limit: 100,
        orderBy: "desc",
      });
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:exchange-sync:trades]",
        symbol,
        e instanceof Error ? e.message : e,
      );
      continue;
    }

    for (const o of orders) {
      const fill = parseDoneOrderFill(o);
      if (!fill || fill.atMs < sinceMs) continue;
      if (fill.side !== "sell") continue;
      if (existingOrderIds.has(fill.orderId)) continue;

      const { positions } = buildPositionsFromTrades(store.trades, program.id);
      const pos = positions.find(
        (p) => p.market === "crypto" && p.symbol === symbol,
      );
      if (!pos || pos.quantity <= 0) continue;

      try {
        recordLiveTradeSellSync(
          {
            programId: program.id,
            symbol,
            market: "crypto",
            quantity: Math.min(fill.volume, pos.quantity),
            price: fill.price,
            orderId: fill.orderId,
            atMs: fill.atMs,
            simulated: false,
            note: "빗썸 체결·거래소 동기화",
          },
          uid,
        );
        existingOrderIds.add(fill.orderId);
        sellsRecorded += 1;
        store.trades = readStoreSync().trades;
      } catch {
        /* 포지션 없음·중복 등 */
      }
    }
  }

  return { sellsRecorded, symbolsChecked: symbols.size };
}

export async function mergeBithumbExchangeTradesLive(snap, userId, programs) {
  const uid = String(userId ?? "").trim();
  if (!uid || !snap) return snap;

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) {
    return enrichHoldingsNotifyReturn(snap, uid);
  }

  const armedCrypto = programs.filter(isArmedCryptoProgram);
  if (!armedCrypto.length) return enrichHoldingsNotifyReturn(snap, uid);

  const existingOrderIds = new Set(
    (snap.trades ?? [])
      .map((t) => String(t.orderId ?? "").trim())
      .filter(Boolean),
  );

  const symbols = await collectLiveExchangeSymbols(credentials, snap);
  const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, "crypto");
  /** @type {object[]} */
  const imported = [];

  for (const symbol of symbols) {
    const base = usdtSymbolToBithumbBase(symbol);
    if (!base) continue;
    const market = `KRW-${base}`;
    const program = resolveProgramForExchangeTrade(programs, symbol);
    if (!program || !isArmedCryptoProgram(program)) continue;

    const sinceMs = liveTradeSinceMs(program);

    let orders = [];
    try {
      orders = await listBithumbDoneOrdersWithCredentials(credentials, market, {
        limit: 100,
        orderBy: "desc",
      });
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:exchange-trades-live]",
        symbol,
        e instanceof Error ? e.message : e,
      );
      continue;
    }

    for (const o of orders) {
      const fill = parseDoneOrderFill(o);
      if (!fill || fill.atMs < sinceMs) continue;
      if (existingOrderIds.has(fill.orderId)) continue;
      existingOrderIds.add(fill.orderId);

      const amount = fill.funds > 0 ? fill.funds : fill.price * fill.volume;
      const feeAmount = amount * oneWayFee;
      imported.push({
        id: `bithumb:${fill.orderId}`,
        programId: program.id,
        programName: program.name,
        side: fill.side,
        symbol,
        name: cryptoYahooUsdtDisplayName(symbol) ?? symbol,
        market: "crypto",
        quantity: fill.volume,
        price: fill.price,
        amount,
        currency: liveTradeCurrency("crypto"),
        feeAmount,
        simulated: false,
        orderId: fill.orderId,
        note: "빗썸 체결·거래소 동기화",
        exchangeImport: true,
        entryPrice: null,
        atMs: fill.atMs,
      });
    }
  }

  if (!imported.length) {
    return enrichHoldingsNotifyReturn(snap, uid);
  }

  const trades = [...(snap.trades ?? []), ...imported].sort(
    (a, b) => b.atMs - a.atMs,
  );
  return enrichHoldingsNotifyReturn(
    {
      ...snap,
      trades: trades.slice(0, 200),
      summary: {
        ...snap.summary,
        tradeCount: trades.length,
      },
    },
    uid,
  );
}

export async function mergeBithumbExchangeTradesAfterNotify(snap, userId, programs) {
  const uid = String(userId ?? "").trim();
  if (!uid || !snap) return snap;

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) {
    return enrichHoldingsNotifyReturn(snap, uid);
  }

  const existingOrderIds = new Set(
    (snap.trades ?? [])
      .map((t) => String(t.orderId ?? "").trim())
      .filter(Boolean),
  );

  /** @type {Set<string>} */
  const symbols = new Set();
  for (const h of snap.holdings ?? []) {
    if (h.market === "crypto") symbols.add(String(h.symbol).trim().toUpperCase());
  }
  for (const t of snap.trades ?? []) {
    if (t.market === "crypto") symbols.add(String(t.symbol).trim().toUpperCase());
  }

  const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, "crypto");
  /** @type {object[]} */
  const imported = [];

  for (const symbol of symbols) {
    const sinceMs = getEarliestTelegramNotifyAtMs(symbol, "crypto");
    if (sinceMs == null) continue;

    const base = usdtSymbolToBithumbBase(symbol);
    if (!base) continue;
    const market = `KRW-${base}`;
    const program = resolveProgramForExchangeTrade(programs, symbol);
    if (!program) continue;

    let orders = [];
    try {
      orders = await listBithumbDoneOrdersWithCredentials(credentials, market, {
        limit: 100,
        orderBy: "desc",
      });
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:exchange-trades]",
        symbol,
        e instanceof Error ? e.message : e,
      );
      continue;
    }

    for (const o of orders) {
      const fill = parseDoneOrderFill(o);
      if (!fill || fill.atMs < sinceMs) continue;
      if (existingOrderIds.has(fill.orderId)) continue;
      existingOrderIds.add(fill.orderId);

      const amount = fill.funds > 0 ? fill.funds : fill.price * fill.volume;
      const feeAmount = amount * oneWayFee;
      imported.push({
        id: `bithumb:${fill.orderId}`,
        programId: program.id,
        programName: program.name,
        side: fill.side,
        symbol,
        name: cryptoYahooUsdtDisplayName(symbol) ?? symbol,
        market: "crypto",
        quantity: fill.volume,
        price: fill.price,
        amount,
        currency: liveTradeCurrency("crypto"),
        feeAmount,
        simulated: false,
        orderId: fill.orderId,
        note: "빗썸 체결·텔레그램 첫 알림 이후",
        exchangeImport: true,
        entryPrice: null,
        atMs: fill.atMs,
      });
    }
  }

  if (!imported.length) {
    return enrichHoldingsNotifyReturn(snap, uid);
  }

  const trades = [...(snap.trades ?? []), ...imported].sort(
    (a, b) => b.atMs - a.atMs,
  );
  return enrichHoldingsNotifyReturn(
    {
      ...snap,
      trades: trades.slice(0, 200),
      summary: {
        ...snap.summary,
        tradeCount: trades.length,
      },
    },
    uid,
  );
}

/**
 * @param {object} snap
 * @param {string} userId
 */
const HISTORY_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 거래내역 UI — 빗썸 체결 API 직접 조회(armed·텔레그램 조건 없음)
 * @param {string} userId
 */
export async function listBithumbTradesFromExchangeApiForHistory(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return [];

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) return [];

  const programs = listLiveTradeProgramsSync(uid);
  const program =
    programs.find((p) => p.markets?.crypto) ?? programs[0] ?? null;
  const programId = program?.id ?? "bithumb-exchange";
  const programName = program?.name ?? "빗썸";

  const sinceMs = Date.now() - HISTORY_LOOKBACK_MS;
  const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, "crypto");
  /** @type {Map<string, { sym: string; market: string }>} */
  const marketByKey = new Map();

  try {
    const accounts = await fetchBithumbAccountsWithCredentials(credentials);
    for (const acc of accounts) {
      const cur = String(acc.currency ?? "").trim().toUpperCase();
      if (!cur || cur === "KRW") continue;
      const sym = bithumbBaseToUsdtSymbol(cur);
      if (!sym) continue;
      const base = usdtSymbolToBithumbBase(sym);
      if (!base) continue;
      marketByKey.set(`KRW-${base}`, { sym, market: `KRW-${base}` });
    }
  } catch (e) {
    liveTradeLogWarn(
      "[live-trade:history-api]",
      "accounts",
      e instanceof Error ? e.message : e,
    );
  }

  for (const t of listLiveTradeRecordsSync(null, uid)) {
    if (t.market !== "crypto") continue;
    const base = usdtSymbolToBithumbBase(t.symbol);
    if (!base) continue;
    marketByKey.set(`KRW-${base}`, {
      sym: String(t.symbol).trim().toUpperCase(),
      market: `KRW-${base}`,
    });
  }

  /** @type {object[]} */
  const out = [];
  const seenOrder = new Set();

  for (const { sym, market } of marketByKey.values()) {
    let orders = [];
    try {
      orders = await listBithumbDoneOrdersWithCredentials(credentials, market, {
        limit: 100,
        orderBy: "desc",
      });
    } catch (e) {
      liveTradeLogWarn(
        "[live-trade:history-api]",
        market,
        e instanceof Error ? e.message : e,
      );
      continue;
    }

    for (const o of orders) {
      const fill = parseDoneOrderFill(o);
      if (!fill || fill.atMs < sinceMs) continue;
      if (seenOrder.has(fill.orderId)) continue;
      seenOrder.add(fill.orderId);

      const amount = fill.funds > 0 ? fill.funds : fill.price * fill.volume;
      out.push({
        id: `bithumb:${fill.orderId}`,
        programId,
        programName,
        side: fill.side,
        symbol: sym,
        name: cryptoYahooUsdtDisplayName(sym) ?? sym,
        market: "crypto",
        quantity: fill.volume,
        price: fill.price,
        amount,
        currency: liveTradeCurrency("crypto"),
        feeAmount: amount * oneWayFee,
        simulated: false,
        orderId: fill.orderId,
        note: "빗썸 체결·API",
        exchangeImport: true,
        entryPrice: null,
        atMs: fill.atMs,
      });
    }
  }

  return out.sort((a, b) => b.atMs - a.atMs);
}

function enrichHoldingsNotifyReturn(snap, userId = "") {
  const feeRate = userId
    ? getRoundTripFeeRateForUserMarketSync(userId, "crypto")
    : 0;
  const holdings = (snap.holdings ?? []).map((h) => {
    if (h.market !== "crypto") return h;
    const baseline = getTelegramNotifyBaseline(h.symbol, "crypto");
    if (!baseline) return h;
    const current =
      h.currentPrice != null && Number.isFinite(h.currentPrice) && h.currentPrice > 0
        ? h.currentPrice
        : null;
    const ref =
      baseline.price != null &&
      Number.isFinite(baseline.price) &&
      baseline.price > 0
        ? baseline.price
        : null;
    const sinceNotifyReturnPct =
      ref != null && current != null
        ? netReturnPct(ref, current, feeRate)
        : null;
    return {
      ...h,
      notifyBaselineAtMs: baseline.atMs,
      notifyBaselinePrice: ref,
      sinceNotifyReturnPct,
    };
  });
  return { ...snap, holdings };
}
