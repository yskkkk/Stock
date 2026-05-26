/**
 * 실매매 보유·거래 내역 — server/.data/live-trade-portfolio.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { pickQuoteFromMap } from "./quote-symbol-resolve.js";
import { resolveLiveTradeQuote } from "./live-trade-quote.js";
import { resolveLiveTradeExitTargets } from "./live-trade-exit-scenario.js";
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  holdingGrossReturnPctFromCost,
  holdingNetReturnPctFromCost,
} from "./net-return.js";
import {
  getOneWayFeeRateForUserMarketSync,
  getRoundTripFeeRateForUserMarketSync,
} from "./exchange-trading-fees.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import { getLiveTradeProgramSync } from "./live-trade-programs-store.js";
import { isBoxRangeProgram } from "./box-range/constants.js";
import { countOpenBoxLotsSync } from "./box-range/store.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import {
  liveTradeCurrency,
  normalizeLiveTradeMarket,
  normalizeSellQuantity,
  resolveOrderAmountForMarket,
  programAllowsMarket,
  quantityFromOrderAmount,
  assertMinCryptoOrderAmountKrw,
} from "./live-trade-market.js";

import { resolveServerDataDir } from "./data-path.js";

function portfolioFilePath() {
  return path.join(resolveServerDataDir(), "live-trade-portfolio.json");
}

/** 레거시 기본 편도 수수료 */
const DEFAULT_ONE_WAY_FEE_RATE = DEFAULT_ROUND_TRIP_FEE_RATE / 2;

/**
 * @typedef {{
 *   id: string;
 *   programId: string;
 *   side: "buy" | "sell";
 *   symbol: string;
 *   name: string;
 *   market: "kr" | "us" | "crypto";
 *   quantity: number;
 *   price: number;
 *   amount: number;
 *   currency: string;
 *   feeAmount: number;
 *   simulated: boolean;
 *   orderId: string | null;
 *   note: string | null;
 *   targetSellPrice: number | null;
 *   stopLossPrice: number | null;
 *   exitScenarioNote: string | null;
 *   entryStructureNote: string | null;
 *   entryIdeal: boolean;
 *   entryKind: string;
 *   buyScore: number | null;
 *   buySignalIds: string[];
 *   entryPrice: number | null;
 *   boxId: string | null;
 *   boxTimeframe: string | null;
 *   atMs: number;
 * }} LiveTradeRecord
 */

function ensureDirSync() {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultStore() {
  return { trades: [] };
}

/** @param {string | null} [programId] @param {string} [userId] */
function tradesVisibleToUser(trades, userId, programId = null) {
  const uid = String(userId ?? "").trim();
  const pid = programId ? String(programId).trim() : null;
  let out = trades;
  if (uid) {
    const allowed = new Set(
      listLiveTradeProgramsSync(uid).map((p) => p.id),
    );
    out = out.filter((t) => allowed.has(t.programId));
  } else {
    out = [];
  }
  if (pid) out = out.filter((t) => t.programId === pid);
  return out;
}

/** @param {string | null} [programId] @param {string} [userId] */
export function listLiveTradeRecordsSync(programId = null, userId) {
  const store = readStoreSync();
  return tradesVisibleToUser(store.trades, userId, programId);
}

/**
 * 프로그램 삭제 시 해당 programId 체결만 제거(다른 시뮬·실매매 보존)
 * @param {string} programId
 */
export function purgeLiveTradeRecordsForProgramSync(programId) {
  const pid = String(programId ?? "").trim();
  if (!pid) return { removed: 0 };
  const store = readStoreSync();
  const before = store.trades.length;
  store.trades = store.trades.filter((t) => t.programId !== pid);
  if (store.trades.length !== before) writeStoreSync(store);
  return { removed: before - store.trades.length };
}

/** 시뮬 전용 프로그램 여부 — 매수 체결이 모두 simulated일 때만 true */
export function programHasOnlySimulatedBuyTradesSync(programId) {
  const pid = String(programId ?? "").trim();
  if (!pid) return false;
  const buys = readStoreSync().trades.filter(
    (t) => t.programId === pid && t.side === "buy",
  );
  if (buys.length === 0) return false;
  return buys.every((t) => t.simulated);
}

export function readStoreSync() {
  try {
    const file = portfolioFilePath();
    if (!fs.existsSync(file)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.trades)) return defaultStore();
    return { trades: o.trades.map(normalizeTrade).filter(Boolean) };
  } catch {
    return defaultStore();
  }
}

export function readPortfolioStoreSync() {
  return readStoreSync();
}

export function writePortfolioStoreSync(store) {
  writeStoreSync(store);
}

function writeStoreSync(store) {
  ensureDirSync();
  const file = portfolioFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 0), "utf8");
  fs.renameSync(tmp, file);
}

/**
 * @param {string} symbol
 * @param {string} name
 * @param {"kr" | "us" | "crypto"} market
 */
function enrichCryptoDisplayName(symbol, name, market) {
  if (market !== "crypto") return name;
  const nm = String(name ?? "").trim();
  if (/[가-힣]/.test(nm) && nm.includes("/")) return nm;
  const display = cryptoYahooUsdtDisplayName(symbol);
  return display || nm || symbol;
}

/** @param {LiveTradeRecord[]} trades */
export function enrichPortfolioTradeNames(trades) {
  return trades.map((t) => ({
    ...t,
    name: enrichCryptoDisplayName(t.symbol, t.name, t.market),
  }));
}

/** @param {object[]} holdings */
function enrichPortfolioHoldingNames(holdings) {
  return holdings.map((h) => ({
    ...h,
    name: enrichCryptoDisplayName(h.symbol, h.name, h.market),
  }));
}

/** @param {unknown} raw @returns {LiveTradeRecord | null} */
function normalizeTrade(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const id = String(o.id ?? "").trim();
  const programId = String(o.programId ?? "").trim();
  const side = o.side === "sell" ? "sell" : o.side === "buy" ? "buy" : null;
  const symbol = String(o.symbol ?? "").trim().toUpperCase();
  if (!id || !programId || !side || !symbol) return null;
  const qty = Number(o.quantity);
  const price = Number(o.price);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const market = normalizeLiveTradeMarket(o.market, symbol);
  let quantity = qty;
  if (market === "crypto") {
    quantity = Math.round(quantity * 1e8) / 1e8;
  } else if (market === "us") {
    quantity = Math.round(quantity * 1e4) / 1e4;
  } else {
    quantity = Math.floor(quantity);
  }
  if (quantity <= 0) return null;
  const amount =
    Number.isFinite(Number(o.amount)) && Number(o.amount) > 0
      ? Number(o.amount)
      : quantity * price;
  return {
    id,
    programId,
    side,
    symbol,
    name: String(o.name ?? symbol).trim() || symbol,
    market,
    quantity,
    price,
    amount,
    currency: liveTradeCurrency(market),
    feeAmount:
      Number.isFinite(Number(o.feeAmount)) && Number(o.feeAmount) >= 0
        ? Number(o.feeAmount)
        : amount * DEFAULT_ONE_WAY_FEE_RATE,
    simulated: Boolean(o.simulated),
    orderId:
      typeof o.orderId === "string" && o.orderId.trim() ? o.orderId.trim() : null,
    note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 300) : null,
    targetSellPrice:
      typeof o.targetSellPrice === "number" && Number.isFinite(o.targetSellPrice) && o.targetSellPrice > 0
        ? o.targetSellPrice
        : null,
    stopLossPrice:
      typeof o.stopLossPrice === "number" && Number.isFinite(o.stopLossPrice) && o.stopLossPrice > 0
        ? o.stopLossPrice
        : null,
    exitScenarioNote:
      typeof o.exitScenarioNote === "string" && o.exitScenarioNote.trim()
        ? o.exitScenarioNote.trim().slice(0, 400)
        : null,
    entryStructureNote:
      typeof o.entryStructureNote === "string" && o.entryStructureNote.trim()
        ? o.entryStructureNote.trim().slice(0, 280)
        : null,
    entryIdeal: Boolean(o.entryIdeal),
    entryKind:
      typeof o.entryKind === "string" && o.entryKind.trim()
        ? o.entryKind.trim().slice(0, 32)
        : "none",
    buyScore:
      typeof o.buyScore === "number" && Number.isFinite(o.buyScore)
        ? o.buyScore
        : null,
    buySignalIds: Array.isArray(o.buySignalIds)
      ? o.buySignalIds.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [],
    entryPrice:
      typeof o.entryPrice === "number" &&
      Number.isFinite(o.entryPrice) &&
      o.entryPrice > 0
        ? o.entryPrice
        : null,
    boxId:
      typeof o.boxId === "string" && o.boxId.trim()
        ? o.boxId.trim().slice(0, 64)
        : null,
    boxTimeframe:
      typeof o.boxTimeframe === "string" && o.boxTimeframe.trim()
        ? o.boxTimeframe.trim().slice(0, 8)
        : null,
    atMs:
      typeof o.atMs === "number" && Number.isFinite(o.atMs) && o.atMs > 0
        ? o.atMs
        : Date.now(),
  };
}

function positionKey(programId, market, symbol) {
  return `${programId}:${market}:${symbol}`;
}

/**
 * 마지막 매수 체결에 기록된 목표·손절·시나리오
 * @param {string} programId
 * @param {"kr"|"us"|"crypto"} market
 * @param {string} symbol
 * @param {{ trades: LiveTradeRecord[] }} [storeIn]
 */
export function getLastBuyExitTargetsSync(programId, market, symbol, storeIn) {
  const store = storeIn ?? readStoreSync();
  const key = positionKey(programId, market, symbol);
  /** @type {LiveTradeRecord | null} */
  let lastBuy = null;
  for (const t of store.trades) {
    if (t.side !== "buy") continue;
    if (positionKey(t.programId, t.market, t.symbol) !== key) continue;
    if (!lastBuy || t.atMs > lastBuy.atMs) lastBuy = t;
  }
  if (!lastBuy) return null;
  return {
    targetSellPrice: lastBuy.targetSellPrice ?? null,
    stopLossPrice: lastBuy.stopLossPrice ?? null,
    exitScenarioNote: lastBuy.exitScenarioNote ?? null,
    entryStructureNote: lastBuy.entryStructureNote ?? null,
    entryIdeal: Boolean(lastBuy.entryIdeal),
    buySignalIds: Array.isArray(lastBuy.buySignalIds) ? lastBuy.buySignalIds : [],
  };
}

/**
 * @param {string} programId
 * @param {"kr"|"us"|"crypto"} market
 * @param {string} symbol
 * @param {{ targetSellPrice?: number | null; stopLossPrice?: number | null; exitScenarioNote?: string | null; entryStructureNote?: string | null; entryIdeal?: boolean }} targets
 */
export function patchLastBuyExitTargetsSync(programId, market, symbol, targets) {
  const store = readStoreSync();
  const key = positionKey(programId, market, symbol);
  let buyIdx = -1;
  let lastAt = -1;
  for (let i = 0; i < store.trades.length; i++) {
    const t = store.trades[i];
    if (t.side !== "buy" || positionKey(t.programId, t.market, t.symbol) !== key) continue;
    if (t.atMs >= lastAt) {
      lastAt = t.atMs;
      buyIdx = i;
    }
  }
  if (buyIdx < 0) return false;
  const prev = store.trades[buyIdx];
  store.trades[buyIdx] = {
    ...prev,
    targetSellPrice:
      targets.targetSellPrice !== undefined
        ? targets.targetSellPrice
        : prev.targetSellPrice,
    stopLossPrice:
      targets.stopLossPrice !== undefined
        ? targets.stopLossPrice
        : prev.stopLossPrice,
    exitScenarioNote:
      targets.exitScenarioNote !== undefined
        ? targets.exitScenarioNote
        : prev.exitScenarioNote,
    entryStructureNote:
      targets.entryStructureNote !== undefined
        ? targets.entryStructureNote
        : prev.entryStructureNote,
    entryIdeal:
      targets.entryIdeal !== undefined
        ? Boolean(targets.entryIdeal)
        : prev.entryIdeal,
  };
  writeStoreSync(store);
  return true;
}

/**
 * @param {LiveTradeRecord[]} trades
 * @param {string | null} programIdFilter
 */
export function buildPositionsFromTrades(trades, programIdFilter) {
  /** @type {Map<string, {
   *   programId: string;
   *   symbol: string;
   *   name: string;
   *   market: "kr" | "us" | "crypto";
   *   quantity: number;
   *   costBasis: number;
   *   feesPaid: number;
   *   openedAtMs: number;
   *   lastAtMs: number;
   * }>} */
  const map = new Map();
  let realizedPnl = 0;

  const sorted = [...trades].sort((a, b) => a.atMs - b.atMs);
  for (const t of sorted) {
    if (programIdFilter && t.programId !== programIdFilter) continue;
    const key = positionKey(t.programId, t.market, t.symbol);
    let pos = map.get(key);
    if (!pos) {
      pos = {
        programId: t.programId,
        symbol: t.symbol,
        name: t.name,
        market: t.market,
        quantity: 0,
        costBasis: 0,
        feesPaid: 0,
        openedAtMs: t.atMs,
        lastAtMs: t.atMs,
      };
      map.set(key, pos);
    }
    pos.name = t.name || pos.name;
    pos.lastAtMs = Math.max(pos.lastAtMs, t.atMs);

    if (t.side === "buy") {
      const wasZero = pos.quantity <= 1e-9;
      pos.quantity += t.quantity;
      pos.costBasis += t.amount + t.feeAmount;
      pos.feesPaid += t.feeAmount;
      if (wasZero) {
        pos.openedAtMs = t.atMs;  // 완전 청산 후 재매수 — openedAtMs 리셋
      } else if (pos.openedAtMs > t.atMs) {
        pos.openedAtMs = t.atMs;
      }
    } else {
      const sellQty = Math.min(t.quantity, pos.quantity);
      if (sellQty <= 0) continue;
      const avgCost = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
      const proportionalFee = t.quantity > 1e-12 ? (t.feeAmount / t.quantity) * sellQty : 0;
      const proceeds = (t.amount / t.quantity) * sellQty - proportionalFee;
      const costPortion = avgCost * sellQty;
      realizedPnl += proceeds - costPortion;
      pos.quantity -= sellQty;
      pos.costBasis -= costPortion;
      if (pos.quantity <= 1e-9) {
        pos.quantity = 0;
        pos.costBasis = 0;
      }
    }
  }

  return {
    positions: [...map.values()].filter((p) => p.quantity > 1e-9),
    realizedPnl,
  };
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 * @param {{ simulated?: boolean; orderId?: string; atMs?: number }} orderMeta
 * @param {{ targetSellPrice?: number | null; stopLossPrice?: number | null; exitScenarioNote?: string | null; entryStructureNote?: string | null; entryIdeal?: boolean; entryKind?: string }} [targets]
 */
export function recordLiveTradeBuySync(
  program,
  pick,
  orderMeta = {},
  targets = null,
  orderAmountOverride = null,
) {
  const symbol = String(pick.symbol ?? "").trim().toUpperCase();
  const market = normalizeLiveTradeMarket(pick.market, symbol);
  const price = Number(pick.price);
  if (!symbol || !Number.isFinite(price) || price <= 0) return null;
  if (!programAllowsMarket(program, market)) return null;
  const tradeAtMs =
    typeof orderMeta.atMs === "number" &&
    Number.isFinite(orderMeta.atMs) &&
    orderMeta.atMs > 0
      ? orderMeta.atMs
      : Date.now();

  const amount = orderAmountOverride;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  /** @type {number} */
  const orderAmount = amount;

  const fillVol = Number(orderMeta.fillVolume);
  let quantity =
    market === "crypto" &&
    Number.isFinite(fillVol) &&
    fillVol > 0
      ? normalizeSellQuantity(fillVol, "crypto")
      : quantityFromOrderAmount(orderAmount, price, market);
  if (quantity <= 0) return null;

  const store = readStoreSync();
  if (isBoxRangeProgram(program)) {
    if (countOpenBoxLotsSync(program.id) >= program.maxOpenPositions) {
      throw new Error(
        `최대 동시 박스 포지션(${program.maxOpenPositions})에 도달했습니다.`,
      );
    }
  } else {
    const { positions } = buildPositionsFromTrades(store.trades, program.id);
    if (positions.length >= program.maxOpenPositions) {
      const already = positions.some(
        (p) => p.symbol === symbol && p.market === market,
      );
      if (!already) {
        throw new Error(
          `최대 보유 종목 수(${program.maxOpenPositions})에 도달했습니다.`,
        );
      }
    }
  }

  const exit =
    targets ??
    (program.autoSellAtTarget === false
      ? {
          targetSellPrice: null,
          stopLossPrice: null,
          exitScenarioNote: null,
        }
      : null);
  const uid = String(program.userId ?? "").trim();
  const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, market);
  const tradeAmount = quantity * price;
  const trade = normalizeTrade({
    id: randomUUID(),
    programId: program.id,
    side: "buy",
    symbol,
    name: String(pick.name ?? symbol),
    market,
    quantity,
    price,
    amount: tradeAmount,
    feeAmount: tradeAmount * oneWayFee,
    simulated: Boolean(orderMeta.simulated),
    orderId: orderMeta.orderId ?? null,
    targetSellPrice: exit?.targetSellPrice ?? null,
    stopLossPrice: exit?.stopLossPrice ?? null,
    exitScenarioNote: exit?.exitScenarioNote ?? null,
    entryStructureNote: exit?.entryStructureNote ?? null,
    entryIdeal: Boolean(exit?.entryIdeal),
    entryKind: exit?.entryKind ?? "none",
    buyScore:
      typeof pick.score === "number" && Number.isFinite(pick.score)
        ? pick.score
        : null,
    buySignalIds: Array.isArray(pick.signalIds)
      ? pick.signalIds.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [],
    boxId:
      typeof pick.boxId === "string" && pick.boxId.trim()
        ? pick.boxId.trim()
        : typeof orderMeta.boxId === "string" && orderMeta.boxId.trim()
          ? orderMeta.boxId.trim()
          : null,
    boxTimeframe:
      typeof pick.boxTimeframe === "string" && pick.boxTimeframe.trim()
        ? pick.boxTimeframe.trim()
        : typeof orderMeta.boxTimeframe === "string" && orderMeta.boxTimeframe.trim()
          ? orderMeta.boxTimeframe.trim()
          : null,
    atMs: tradeAtMs,
  });
  if (!trade) return null;
  store.trades.push(trade);
  writeStoreSync(store);
  return trade;
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 * @param {{ simulated?: boolean; orderId?: string; atMs?: number; boxId?: string; boxTimeframe?: string }} [orderMeta]
 */
export async function recordLiveTradeBuyAsync(program, pick, orderMeta = {}) {
  const symbol = String(pick.symbol ?? "").trim().toUpperCase();
  const market = normalizeLiveTradeMarket(pick.market, symbol);
  const price = Number(pick.price);
  const orderAmount = await resolveOrderAmountForMarket(program, market);
  assertMinCryptoOrderAmountKrw(market, orderAmount);
  let targets = null;
  const uid = String(program.userId ?? "").trim();
  const roundTripFeeRate = getRoundTripFeeRateForUserMarketSync(uid, market);
  const boxId = String(orderMeta.boxId ?? pick.boxId ?? "").trim();
  if (boxId) {
    targets = {
      targetSellPrice: orderMeta.targetSellPrice ?? null,
      stopLossPrice: orderMeta.stopLossPrice ?? null,
      exitScenarioNote: `box:${boxId}`,
      entryKind: `box:${orderMeta.boxTimeframe ?? pick.boxTimeframe ?? "?"}`,
      entryStructureNote: "박스권",
    };
  } else if (
    program.autoSellAtTarget !== false &&
    symbol &&
    Number.isFinite(price) &&
    price > 0
  ) {
    targets = await resolveLiveTradeExitTargets(symbol, price, {
      market,
      signalIds: pick.signalIds,
      score: pick.score,
      roundTripFeeRate,
      sellHorizon: program.sellHorizon,
    });
  } else if (program.autoSellAtTarget === false) {
    targets = {
      targetSellPrice: null,
      stopLossPrice: null,
      exitScenarioNote: null,
    };
  }
  return recordLiveTradeBuySync(program, pick, orderMeta, targets, orderAmount);
}

/**
 * @param {{
 *   programId: string;
 *   symbol: string;
 *   market?: string;
 *   name?: string;
 *   price?: number;
 * }} input
 */
export async function recordLiveTradeSimBuyAsync(input, userId) {
  const programId = String(input.programId ?? "").trim();
  const program = getLiveTradeProgramSync(programId, userId);
  if (!program) throw new Error("프로그램을 찾을 수 없습니다.");
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const market = normalizeLiveTradeMarket(input.market, symbol);
  if (!symbol) throw new Error("종목 코드가 필요합니다.");
  if (!programAllowsMarket(program, market)) {
    throw new Error("프로그램에서 허용하지 않는 시장입니다.");
  }
  const quote = await resolveLiveTradeQuote(symbol);
  const customPrice = Number(input.price);
  const fillPrice =
    Number.isFinite(customPrice) && customPrice > 0 ? customPrice : quote.price;
  const trade = await recordLiveTradeBuyAsync(
    program,
    {
      symbol: quote.symbol,
      name: String(input.name ?? symbol).trim() || symbol,
      market,
      price: fillPrice,
      signalIds: input.signalIds,
      score: input.score,
    },
    { simulated: true, atMs: quote.atMs },
  );
  if (!trade) throw new Error("매수 시뮬레이션을 저장하지 못했습니다.");
  return { trade, quote: { ...quote, price: fillPrice } };
}

/**
 * @param {{
 *   programId: string;
 *   symbol: string;
 *   market?: string;
 *   quantity?: number;
 *   price: number;
 *   note?: string;
 *   simulated?: boolean;
 *   atMs?: number;
 * }} input
 */
export function recordLiveTradeSellSync(input, userId) {
  const programId = String(input.programId ?? "").trim();
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const market = normalizeLiveTradeMarket(input.market, symbol);
  const price = Number(input.price);
  if (!programId || !symbol || !Number.isFinite(price) || price <= 0) {
    throw new Error("매도 기록에 필요한 값이 없습니다.");
  }
  const tradeAtMs =
    typeof input.atMs === "number" && Number.isFinite(input.atMs) && input.atMs > 0
      ? input.atMs
      : Date.now();
  if (!getLiveTradeProgramSync(programId, userId)) {
    throw new Error("프로그램을 찾을 수 없습니다.");
  }

  const store = readStoreSync();
  const { positions } = buildPositionsFromTrades(store.trades, programId);
  const key = positionKey(programId, market, symbol);
  const pos = positions.find(
    (p) => positionKey(p.programId, p.market, p.symbol) === key,
  );
  if (!pos || pos.quantity <= 0) {
    throw new Error("보유 수량이 없습니다.");
  }

  let quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) quantity = pos.quantity;
  quantity = Math.min(quantity, pos.quantity);
  quantity = normalizeSellQuantity(quantity, market);
  if (quantity <= 0) throw new Error("매도 수량이 올바르지 않습니다.");

  const avgEntry = pos.quantity > 1e-9 && pos.costBasis > 0 ? pos.costBasis / pos.quantity : 0;
  const customEntry = Number(input.entryPrice);
  const entryForSell =
    Number.isFinite(customEntry) && customEntry > 0 ? customEntry : avgEntry;
  const uid = String(userId ?? "").trim();
  const oneWayFee = getOneWayFeeRateForUserMarketSync(uid, market);
  const sellAmount = quantity * price;

  const trade = normalizeTrade({
    id: randomUUID(),
    programId,
    side: "sell",
    symbol,
    name: pos.name,
    market,
    quantity,
    price,
    amount: sellAmount,
    feeAmount: sellAmount * oneWayFee,
    entryPrice: entryForSell > 0 ? entryForSell : null,
    boxId:
      typeof input.boxId === "string" && input.boxId.trim()
        ? input.boxId.trim()
        : null,
    boxTimeframe:
      typeof input.boxTimeframe === "string" && input.boxTimeframe.trim()
        ? input.boxTimeframe.trim()
        : null,
    note: input.note ?? null,
    simulated: Boolean(input.simulated),
    orderId: input.orderId ?? null,
    atMs: tradeAtMs,
  });
  if (!trade) throw new Error("매도 기록을 저장하지 못했습니다.");
  store.trades.push(trade);
  writeStoreSync(store);
  return trade;
}

/**
 * @param {{
 *   programId: string;
 *   symbol: string;
 *   market?: string;
 *   quantity?: number;
 *   price?: number;
 *   note?: string;
 * }} input
 */
export async function recordLiveTradeSimSellAsync(input, userId) {
  const programId = String(input.programId ?? "").trim();
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!programId || !symbol) {
    throw new Error("매도 시뮬레이션에 필요한 값이 없습니다.");
  }
  const quote = await resolveLiveTradeQuote(symbol);
  const customPrice = Number(input.price);
  const fillPrice =
    Number.isFinite(customPrice) && customPrice > 0 ? customPrice : quote.price;
  const trade = recordLiveTradeSellSync(
    {
      programId,
      symbol: quote.symbol,
      market: input.market,
      quantity: input.quantity,
      price: fillPrice,
      note: input.note,
      simulated: true,
      atMs: quote.atMs,
    },
    userId,
  );
  return { trade, quote: { ...quote, price: fillPrice } };
}

/**
 * @param {{ programId?: string | null }} [opts]
 */
/**
 * 시뮬 자동매도용 — 열린 포지션 + 매수 시 기록된 목표·손절가
 */
export function buildOpenPositionsWithSellTargetsSync() {
  const store = readStoreSync();
  const { positions } = buildPositionsFromTrades(store.trades, null);

  return positions.map((pos) => {
    const key = positionKey(pos.programId, pos.market, pos.symbol);
    const buys = store.trades
      .filter(
        (t) =>
          t.side === "buy" &&
          positionKey(t.programId, t.market, t.symbol) === key,
      )
      .sort((a, b) => a.atMs - b.atMs);
    const lastBuy = buys[buys.length - 1] ?? null;
    const avgEntry = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
    return {
      programId: pos.programId,
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      quantity: pos.quantity,
      avgEntryPrice: avgEntry,
      targetSellPrice: lastBuy?.targetSellPrice ?? null,
      stopLossPrice: lastBuy?.stopLossPrice ?? null,
      boughtAtMs: lastBuy?.atMs ?? null,
      buySignalIds: Array.isArray(lastBuy?.buySignalIds) ? lastBuy.buySignalIds : [],
    };
  });
}

/**
 * 보유 종목(평가·매입) 기준 현재 수익률 — 실현손익·과거 체결 제외
 * @param {object[]} holdings
 */
export function openReturnPctFromHoldings(holdings) {
  let invested = 0;
  let market = 0;
  for (const h of holdings) {
    const cost = Number(h.costBasis);
    const mv = h.marketValue;
    if (Number.isFinite(cost) && cost > 0) invested += cost;
    if (mv != null && Number.isFinite(mv) && mv > 0) market += mv;
  }
  if (invested > 0 && market > 0) {
    return ((market - invested) / invested) * 100;
  }
  let totalMv = 0;
  let weighted = 0;
  for (const h of holdings) {
    const mv = h.marketValue;
    const pct = h.changePct;
    if (mv != null && mv > 0 && pct != null && Number.isFinite(pct)) {
      totalMv += mv;
      weighted += pct * mv;
    }
  }
  if (totalMv > 0) return weighted / totalMv;
  return null;
}

/**
 * programReturns — portfolio 스냅샷 보유와 동일 기준으로 totalReturnPct 동기화
 * @param {Record<string, { totalReturnPct: number | null; holdingCount: number }>} out
 * @param {string} userId
 */
export async function enrichProgramReturnsFromHoldings(out, userId) {
  const snap = await buildLiveTradePortfolioSnapshot({ userId });
  /** @type {Map<string, object[]>} */
  const byProgram = new Map();
  for (const h of snap.holdings) {
    const pid = String(h.programId ?? "").trim();
    if (!pid) continue;
    if (!byProgram.has(pid)) byProgram.set(pid, []);
    byProgram.get(pid).push(h);
  }
  for (const [pid, holdings] of byProgram) {
    if (!out[pid]) out[pid] = { totalReturnPct: null, holdingCount: 0 };
    out[pid].holdingCount = holdings.length;
  }
  return out;
}

/**
 * 프로그램 카드·상태 API용 — 종목 시세 1회 배치 조회
 * @param {string[]} programIds
 * @returns {Promise<Record<string, { totalReturnPct: number | null; holdingCount: number }>>}
 */
export async function buildProgramPortfolioSummariesMap(programIds, userId) {
  const store = readStoreSync();
  const uid = String(userId ?? "").trim();
  let ids = [...new Set(programIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (uid) {
    const allowed = new Set(listLiveTradeProgramsSync(uid).map((p) => p.id));
    ids = ids.filter((id) => allowed.has(id));
  }

  /** @type {Map<string, { positions: object[]; realizedPnl: number; investedOpen: number; closedCost: number }>} */
  const perProgram = new Map();
  for (const pid of ids) {
    const { positions, realizedPnl } = buildPositionsFromTrades(store.trades, pid);
    const trades = store.trades.filter((t) => t.programId === pid);
    let investedOpen = 0;
    for (const pos of positions) investedOpen += pos.costBasis;
    const totalBuyCost = trades
      .filter((t) => t.side === "buy")
      .reduce((s, t) => s + t.amount + t.feeAmount, 0);
    perProgram.set(pid, {
      positions,
      realizedPnl,
      investedOpen,
      totalBuyCost,
      holdingCount: positions.length,
    });
  }

  const symbols = [
    ...new Set(
      [...perProgram.values()].flatMap((d) => d.positions.map((p) => p.symbol)),
    ),
  ];
  const quotes =
    symbols.length > 0
      ? await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 })
      : {};

  /** @type {Record<string, { totalReturnPct: number | null; holdingCount: number }>} */
  const out = {};
  for (const [pid, data] of perProgram) {
    let marketValueOpen = 0;
    for (const pos of data.positions) {
      const q = pickQuoteFromMap(quotes, pos.symbol, pos.market);
      const cp =
        q?.price != null && Number.isFinite(q.price) && q.price > 0
          ? q.price
          : null;
      if (cp != null) marketValueOpen += cp * pos.quantity;
    }
    const unrealizedPnl = marketValueOpen - data.investedOpen;
    const totalPnl = data.realizedPnl + unrealizedPnl;
    let totalReturnPct =
      data.totalBuyCost > 0 ? (totalPnl / data.totalBuyCost) * 100 : null;
    if (totalReturnPct != null && !Number.isFinite(totalReturnPct)) {
      totalReturnPct = null;
    }
    out[pid] = {
      totalReturnPct,
      holdingCount: data.holdingCount,
      realizedPnl: data.realizedPnl,
      totalPnl,
    };
  }
  for (const pid of ids) {
    if (!out[pid]) out[pid] = { totalReturnPct: null, holdingCount: 0 };
  }
  const programs = listLiveTradeProgramsSync(uid).filter((p) =>
    ids.includes(p.id),
  );
  const { applyBithumbExchangeToProgramReturns } = await import(
    "./live-trade-bithumb-holdings.js"
  );
  await applyBithumbExchangeToProgramReturns(out, programs);
  return out;
}

export async function buildLiveTradePortfolioSnapshot(opts = {}) {
  const programIdFilter = opts.programId
    ? String(opts.programId).trim()
    : null;
  const userId = opts.userId ? String(opts.userId).trim() : "";
  const store = readStoreSync();
  const scopedTrades = tradesVisibleToUser(
    store.trades,
    userId,
    programIdFilter,
  );
  let trades = [...scopedTrades];
  trades.sort((a, b) => b.atMs - a.atMs);

  const visibleAll = tradesVisibleToUser(store.trades, userId, null);
  const { positions, realizedPnl } = buildPositionsFromTrades(
    visibleAll,
    programIdFilter,
  );

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const quotes =
    symbols.length > 0
      ? await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 })
      : {};

  /** @type {object[]} */
  const holdings = [];
  let investedOpen = 0;
  let marketValueOpen = 0;

  for (const pos of positions) {
    const q = pickQuoteFromMap(quotes, pos.symbol, pos.market);
    const currentPrice =
      q?.price != null && Number.isFinite(q.price) && q.price > 0
        ? q.price
        : null;
    const avgEntry = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
    investedOpen += pos.costBasis;
    const mv =
      currentPrice != null ? currentPrice * pos.quantity : null;
    if (mv != null) marketValueOpen += mv;
    const feeRate = getRoundTripFeeRateForUserMarketSync(userId, pos.market);
    const grossPct =
      mv != null ? holdingGrossReturnPctFromCost(pos.costBasis, mv) : null;
    const netPct =
      mv != null
        ? holdingNetReturnPctFromCost(pos.costBasis, mv, feeRate)
        : null;
    const unrealized =
      mv != null ? mv - pos.costBasis : null;
    const key = positionKey(pos.programId, pos.market, pos.symbol);
    let targetSellPrice = null;
    let stopLossPrice = null;
    let exitScenarioNote = null;
    let entryStructureNote = null;
    let entryIdeal = false;
    for (const t of visibleAll) {
      if (t.side !== "buy") continue;
      if (positionKey(t.programId, t.market, t.symbol) !== key) continue;
      if (t.targetSellPrice != null) targetSellPrice = t.targetSellPrice;
      if (t.stopLossPrice != null) stopLossPrice = t.stopLossPrice;
      if (t.exitScenarioNote) exitScenarioNote = t.exitScenarioNote;
      if (t.entryStructureNote) entryStructureNote = t.entryStructureNote;
      if (t.entryIdeal) entryIdeal = true;
    }

    const quoteSrc =
      q?.priceSource === "over" || q?.priceSource === "regular" || q?.priceSource === "1m"
        ? q.priceSource
        : q?.interval === "over" || q?.interval === "regular"
          ? q.interval
          : q?.interval === "1m"
            ? "1m"
            : null;

    holdings.push({
      programId: pos.programId,
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      quantity: pos.quantity,
      avgEntryPrice: avgEntry,
      costBasis: pos.costBasis,
      currentPrice,
      marketValue: mv,
      unrealizedPnl: unrealized,
      changePct: netPct,
      grossChangePct: grossPct,
      targetSellPrice,
      stopLossPrice,
      exitScenarioNote,
      entryStructureNote,
      entryIdeal,
      currency: liveTradeCurrency(pos.market),
      openedAtMs: pos.openedAtMs,
      lastAtMs: pos.lastAtMs,
      quoteQuotedAtMs:
        typeof q?.quotedAtMs === "number" && q.quotedAtMs > 0 ? q.quotedAtMs : null,
      priceSource: quoteSrc,
    });
  }

  holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const unrealizedPnl = marketValueOpen - investedOpen;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalBuyCost = visibleAll
    .filter((t) => (programIdFilter ? t.programId === programIdFilter : true) && t.side === "buy")
    .reduce((s, t) => s + t.amount + t.feeAmount, 0);
  const totalReturnPct =
    totalBuyCost > 0 ? (totalPnl / totalBuyCost) * 100 : null;

  const snap = {
    updatedAtMs: Date.now(),
    programId: programIdFilter,
    summary: {
      holdingCount: holdings.length,
      investedOpen,
      marketValueOpen,
      unrealizedPnl,
      realizedPnl,
      totalPnl,
      totalReturnPct,
      tradeCount: trades.length,
    },
    holdings,
    trades: trades.slice(0, 200),
  };
  const programs = listLiveTradeProgramsSync(userId || undefined);
  const { mergeBithumbExchangeHoldings } = await import(
    "./live-trade-bithumb-holdings.js"
  );
  const merged = await mergeBithumbExchangeHoldings(snap, programs);
  let withExchangeTrades = merged;
  if (opts.exchangeSyncLive) {
    const { refreshCryptoHoldingsFromExchange } = await import(
      "./live-trade-bithumb-holdings.js"
    );
    const { mergeBithumbExchangeTradesLive } = await import(
      "./live-trade-bithumb-exchange-trades.js"
    );
    const fromExchange = await refreshCryptoHoldingsFromExchange(
      merged,
      programs,
    );
    withExchangeTrades = await mergeBithumbExchangeTradesLive(
      fromExchange,
      userId,
      programs,
    );
  } else {
    const { mergeBithumbExchangeTradesAfterNotify } = await import(
      "./live-trade-bithumb-exchange-trades.js"
    );
    withExchangeTrades = await mergeBithumbExchangeTradesAfterNotify(
      merged,
      userId,
      programs,
    );
  }
  const openPct = openReturnPctFromHoldings(withExchangeTrades.holdings);
  if (openPct != null && Number.isFinite(openPct)) {
    withExchangeTrades.summary.totalReturnPct = openPct;
  }
  return {
    ...withExchangeTrades,
    holdings: enrichPortfolioHoldingNames(withExchangeTrades.holdings),
    trades: enrichPortfolioTradeNames(withExchangeTrades.trades),
  };
}
