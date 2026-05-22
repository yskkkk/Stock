/**
 * 실매매 보유·거래 내역 — server/.data/live-trade-portfolio.json
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { resolveLiveTradeQuote } from "./live-trade-quote.js";
import { ROUND_TRIP_FEE_RATE } from "./net-return.js";
import { getLiveTradeProgramSync } from "./live-trade-programs-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, ".data");
const PORTFOLIO_FILE = path.join(DATA_DIR, "live-trade-portfolio.json");

/** 매도·매수 각 0.1% (왕복 0.2%) */
const ONE_WAY_FEE_RATE = ROUND_TRIP_FEE_RATE / 2;

/**
 * @typedef {{
 *   id: string;
 *   programId: string;
 *   side: "buy" | "sell";
 *   symbol: string;
 *   name: string;
 *   market: "kr" | "us";
 *   quantity: number;
 *   price: number;
 *   amount: number;
 *   currency: string;
 *   feeAmount: number;
 *   simulated: boolean;
 *   orderId: string | null;
 *   note: string | null;
 *   atMs: number;
 * }} LiveTradeRecord
 */

function ensureDirSync() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultStore() {
  return { trades: [] };
}

function readStoreSync() {
  try {
    if (!fs.existsSync(PORTFOLIO_FILE)) return defaultStore();
    const o = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf8"));
    if (!o || typeof o !== "object" || !Array.isArray(o.trades)) return defaultStore();
    return { trades: o.trades.map(normalizeTrade).filter(Boolean) };
  } catch {
    return defaultStore();
  }
}

function writeStoreSync(store) {
  ensureDirSync();
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(store, null, 0), "utf8");
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
  const market = o.market === "us" ? "us" : "kr";
  const amount =
    Number.isFinite(Number(o.amount)) && Number(o.amount) > 0
      ? Number(o.amount)
      : qty * price;
  return {
    id,
    programId,
    side,
    symbol,
    name: String(o.name ?? symbol).trim() || symbol,
    market,
    quantity: qty,
    price,
    amount,
    currency: market === "kr" ? "KRW" : "USD",
    feeAmount:
      Number.isFinite(Number(o.feeAmount)) && Number(o.feeAmount) >= 0
        ? Number(o.feeAmount)
        : amount * ONE_WAY_FEE_RATE,
    simulated: Boolean(o.simulated),
    orderId:
      typeof o.orderId === "string" && o.orderId.trim() ? o.orderId.trim() : null,
    note: typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 300) : null,
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
 * @param {LiveTradeRecord[]} trades
 * @param {string | null} programIdFilter
 */
function buildPositionsFromTrades(trades, programIdFilter) {
  /** @type {Map<string, {
   *   programId: string;
   *   symbol: string;
   *   name: string;
   *   market: "kr" | "us";
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
      pos.quantity += t.quantity;
      pos.costBasis += t.amount + t.feeAmount;
      pos.feesPaid += t.feeAmount;
      if (pos.quantity > 0 && pos.openedAtMs > t.atMs) pos.openedAtMs = t.atMs;
    } else {
      const sellQty = Math.min(t.quantity, pos.quantity);
      if (sellQty <= 0) continue;
      const avgCost = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
      const proceeds = (t.amount / t.quantity) * sellQty - t.feeAmount;
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
 */
export function recordLiveTradeBuySync(program, pick, orderMeta = {}) {
  const symbol = String(pick.symbol ?? "").trim().toUpperCase();
  const market = pick.market === "us" ? "us" : "kr";
  const price = Number(pick.price);
  if (!symbol || !Number.isFinite(price) || price <= 0) return null;
  const tradeAtMs =
    typeof orderMeta.atMs === "number" &&
    Number.isFinite(orderMeta.atMs) &&
    orderMeta.atMs > 0
      ? orderMeta.atMs
      : Date.now();

  const amount =
    market === "kr"
      ? program.orderAmountKrw
      : program.orderAmountUsd;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;

  let quantity = Math.floor(amount / price);
  if (market === "kr" && quantity < 1) quantity = 1;

  const store = readStoreSync();
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

  const trade = normalizeTrade({
    id: randomUUID(),
    programId: program.id,
    side: "buy",
    symbol,
    name: String(pick.name ?? symbol),
    market,
    quantity,
    price,
    amount: quantity * price,
    simulated: Boolean(orderMeta.simulated),
    orderId: orderMeta.orderId ?? null,
    atMs: tradeAtMs,
  });
  if (!trade) return null;
  store.trades.push(trade);
  writeStoreSync(store);
  return trade;
}

/**
 * @param {{
 *   programId: string;
 *   symbol: string;
 *   market?: string;
 *   name?: string;
 * }} input
 */
export async function recordLiveTradeSimBuyAsync(input) {
  const programId = String(input.programId ?? "").trim();
  const program = getLiveTradeProgramSync(programId);
  if (!program) throw new Error("프로그램을 찾을 수 없습니다.");
  const market = input.market === "us" ? "us" : "kr";
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!symbol) throw new Error("종목 코드가 필요합니다.");
  const quote = await resolveLiveTradeQuote(symbol);
  const trade = recordLiveTradeBuySync(
    program,
    {
      symbol: quote.symbol,
      name: String(input.name ?? symbol).trim() || symbol,
      market,
      price: quote.price,
    },
    { simulated: true, atMs: quote.atMs },
  );
  if (!trade) throw new Error("매수 시뮬레이션을 저장하지 못했습니다.");
  return { trade, quote };
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
export function recordLiveTradeSellSync(input) {
  const programId = String(input.programId ?? "").trim();
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const market = input.market === "us" ? "us" : "kr";
  const price = Number(input.price);
  if (!programId || !symbol || !Number.isFinite(price) || price <= 0) {
    throw new Error("매도 기록에 필요한 값이 없습니다.");
  }
  const tradeAtMs =
    typeof input.atMs === "number" && Number.isFinite(input.atMs) && input.atMs > 0
      ? input.atMs
      : Date.now();
  if (!getLiveTradeProgramSync(programId)) {
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
  if (market === "kr") quantity = Math.floor(quantity);
  if (quantity <= 0) throw new Error("매도 수량이 올바르지 않습니다.");

  const trade = normalizeTrade({
    id: randomUUID(),
    programId,
    side: "sell",
    symbol,
    name: pos.name,
    market,
    quantity,
    price,
    amount: quantity * price,
    note: input.note ?? null,
    simulated: Boolean(input.simulated),
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
 *   note?: string;
 * }} input
 */
export async function recordLiveTradeSimSellAsync(input) {
  const programId = String(input.programId ?? "").trim();
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  if (!programId || !symbol) {
    throw new Error("매도 시뮬레이션에 필요한 값이 없습니다.");
  }
  const quote = await resolveLiveTradeQuote(symbol);
  const trade = recordLiveTradeSellSync({
    programId,
    symbol: quote.symbol,
    market: input.market,
    quantity: input.quantity,
    price: quote.price,
    note: input.note,
    simulated: true,
    atMs: quote.atMs,
  });
  return { trade, quote };
}

/**
 * @param {{ programId?: string | null }} [opts]
 */
export async function buildLiveTradePortfolioSnapshot(opts = {}) {
  const programIdFilter = opts.programId
    ? String(opts.programId).trim()
    : null;
  const store = readStoreSync();
  let trades = [...store.trades];
  if (programIdFilter) {
    trades = trades.filter((t) => t.programId === programIdFilter);
  }
  trades.sort((a, b) => b.atMs - a.atMs);

  const { positions, realizedPnl } = buildPositionsFromTrades(
    store.trades,
    programIdFilter,
  );

  const symbols = [...new Set(positions.map((p) => p.symbol))];
  const quotes =
    symbols.length > 0 ? await fetchQuoteSnapshotsForSymbols(symbols) : {};

  /** @type {object[]} */
  const holdings = [];
  let investedOpen = 0;
  let marketValueOpen = 0;

  for (const pos of positions) {
    const q = quotes[pos.symbol];
    const currentPrice =
      q?.price != null && Number.isFinite(q.price) && q.price > 0
        ? q.price
        : null;
    const avgEntry = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
    investedOpen += pos.costBasis;
    const mv =
      currentPrice != null ? currentPrice * pos.quantity : null;
    if (mv != null) marketValueOpen += mv;
    const grossPct =
      currentPrice != null && avgEntry > 0
        ? ((currentPrice - avgEntry) / avgEntry) * 100
        : null;
    const netPct =
      currentPrice != null && avgEntry > 0
        ? (currentPrice / avgEntry) * (1 - ROUND_TRIP_FEE_RATE) * 100 - 100
        : null;
    const unrealized =
      mv != null ? mv - pos.costBasis : null;
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
      currency: pos.market === "kr" ? "KRW" : "USD",
      openedAtMs: pos.openedAtMs,
      lastAtMs: pos.lastAtMs,
    });
  }

  holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const unrealizedPnl = marketValueOpen - investedOpen;
  const totalPnl = realizedPnl + unrealizedPnl;
  const closedCost = trades
    .filter((t) => t.side === "sell")
    .reduce((s, t) => s + t.amount, 0);
  const totalReturnPct =
    investedOpen + closedCost > 0
      ? (totalPnl / (investedOpen + closedCost)) * 100
      : investedOpen > 0
        ? (unrealizedPnl / investedOpen) * 100
        : null;

  return {
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
}
