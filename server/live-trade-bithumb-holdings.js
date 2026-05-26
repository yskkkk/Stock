/**
 * 빗썸 거래소 잔고 → 앱에 기록되지 않은 실매매 보유 표시(테스트·수동 주문 포함)
 */
import { isBinanceUsdtSymbol } from "./binance-usdt.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import {
  fetchBithumbAccountsWithCredentials,
  getBithumbTradingStatusFromCredentials,
} from "./bithumb-trading-adapter.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { fetchQuoteSnapshotsForSymbols } from "./picks-live-quotes.js";
import { pickQuoteFromMap } from "./quote-symbol-resolve.js";
import {
  holdingGrossReturnPctFromCost,
  holdingNetReturnPctFromCost,
  netReturnPct,
} from "./net-return.js";
import { getBithumbRoundTripFeeRateSync } from "./exchange-trading-fees.js";
import { liveTradeCurrency } from "./live-trade-market.js";
import {
  buildPositionsFromTrades,
  getLastBuyExitTargetsSync,
  patchLastBuyExitTargetsSync,
  readStoreSync,
} from "./live-trade-portfolio-store.js";
import { resolveLiveTradeExitTargets } from "./live-trade-exit-scenario.js";

const MIN_DISPLAY_KRW = 1_000;

/**
 * 거래소 잔고 전체가 아니라 프로그램 매수 원장 수량·원가로 표시(실매매 배분 한도 반영)
 * @param {number} exchangeQty
 * @param {number | null} exchangeAvgEntry
 * @param {{ quantity: number; costBasis: number } | null | undefined} ledgerPos
 */
export function applyProgramLedgerToBithumbHoldingMetrics(
  exchangeQty,
  exchangeAvgEntry,
  ledgerPos,
) {
  const qtyEx = Number(exchangeQty);
  let quantity = Number.isFinite(qtyEx) && qtyEx > 0 ? qtyEx : 0;
  let avgEntry =
    exchangeAvgEntry != null &&
    Number.isFinite(exchangeAvgEntry) &&
    exchangeAvgEntry > 0
      ? exchangeAvgEntry
      : 0;

  if (ledgerPos && ledgerPos.quantity > 1e-9) {
    quantity = Math.min(quantity, ledgerPos.quantity);
    avgEntry =
      ledgerPos.quantity > 0
        ? ledgerPos.costBasis / ledgerPos.quantity
        : avgEntry;
  }

  const costBasis = avgEntry > 0 && quantity > 0 ? avgEntry * quantity : 0;
  return { quantity, avgEntry, costBasis };
}

/** @param {string} base e.g. BTC */
export function bithumbBaseToUsdtSymbol(base) {
  const b = String(base ?? "").trim().toUpperCase();
  if (!b || b === "KRW") return null;
  const sym = `${b}-USDT`;
  return isBinanceUsdtSymbol(sym) ? sym : null;
}

/** @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} armedCrypto */
export function pickArmedProgramForSymbol(armedCrypto, symbol, store) {
  const withTrade = armedCrypto.filter((p) =>
    store.trades.some(
      (t) =>
        t.programId === p.id &&
        t.side === "buy" &&
        t.market === "crypto" &&
        t.symbol === symbol,
    ),
  );
  if (withTrade.length === 1) return withTrade[0];
  if (withTrade.length > 1) {
    const sorted = [...withTrade].sort((a, b) => {
      const ta = Math.max(
        0,
        ...store.trades
          .filter((t) => t.programId === a.id && t.symbol === symbol)
          .map((t) => t.atMs),
      );
      const tb = Math.max(
        0,
        ...store.trades
          .filter((t) => t.programId === b.id && t.symbol === symbol)
          .map((t) => t.atMs),
      );
      return tb - ta;
    });
    return sorted[0];
  }
  if (armedCrypto.length === 1) return armedCrypto[0];
  return null;
}

function isArmedCryptoProgram(p) {
  if (p.status !== "armed") return false;
  if (p.armedMarkets?.crypto) return true;
  return Boolean(p.markets?.crypto && !p.markets?.kr);
}

/**
 * 앱 매수 기록 → 없으면 일봉 exit-scenario로 목표·손절 산정(테스터 표시·자동매도용)
 * @param {string} programId
 * @param {string} symbol
 * @param {number | null} avgEntry
 * @param {string} userId
 * @param {{ trades: import("./live-trade-portfolio-store.js").LiveTradeRecord[] }} store
 */
async function resolveCryptoHoldingExitTargets(programId, symbol, avgEntry, userId, store) {
  const fromTrade = getLastBuyExitTargetsSync(programId, "crypto", symbol, store);
  const entry = Number(avgEntry);
  const hasPrices =
    fromTrade?.targetSellPrice != null &&
    fromTrade?.stopLossPrice != null &&
    Number.isFinite(fromTrade.targetSellPrice) &&
    Number.isFinite(fromTrade.stopLossPrice);

  if (hasPrices) return fromTrade;

  if (!Number.isFinite(entry) || entry <= 0) {
    return (
      fromTrade ?? {
        targetSellPrice: null,
        stopLossPrice: null,
        exitScenarioNote: null,
        entryStructureNote: null,
        entryIdeal: false,
        buySignalIds: [],
      }
    );
  }

  const feeRate = getBithumbRoundTripFeeRateSync(userId);
  let computed;
  try {
    computed = await resolveLiveTradeExitTargets(symbol, entry, {
      market: "crypto",
      signalIds: fromTrade?.buySignalIds ?? [],
      roundTripFeeRate: feeRate,
      sellHorizon: "short",
    });
  } catch (e) {
    console.warn(
      "[bithumb-holdings] exit targets:",
      symbol,
      e instanceof Error ? e.message : e,
    );
    return fromTrade ?? {
      targetSellPrice: null,
      stopLossPrice: null,
      exitScenarioNote: null,
      entryStructureNote: null,
      entryIdeal: false,
      buySignalIds: [],
    };
  }

  const merged = {
    targetSellPrice:
      fromTrade?.targetSellPrice ?? computed.targetSellPrice ?? null,
    stopLossPrice: fromTrade?.stopLossPrice ?? computed.stopLossPrice ?? null,
    exitScenarioNote: fromTrade?.exitScenarioNote ?? computed.exitScenarioNote ?? null,
    entryStructureNote:
      fromTrade?.entryStructureNote ?? computed.entryStructureNote ?? null,
    entryIdeal: fromTrade?.entryIdeal ?? Boolean(computed.entryIdeal),
    buySignalIds: fromTrade?.buySignalIds ?? [],
  };

  if (
    merged.targetSellPrice != null &&
    merged.stopLossPrice != null &&
    getLastBuyExitTargetsSync(programId, "crypto", symbol, store) != null
  ) {
    patchLastBuyExitTargetsSync(programId, "crypto", symbol, merged);
  }

  return merged;
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 * @param {import("./bithumb-trading-adapter.js").BithumbCredentials | null} credentials
 */
async function listBithumbExchangeOverlayRowsForCredentials(
  programs,
  credentials,
  userId = "",
  opts = {},
) {
  const overlayOnly = opts.overlayOnly !== false;
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) return [];

  const armedCrypto = programs.filter(isArmedCryptoProgram);
  if (!armedCrypto.length) return [];
  const feeRate = getBithumbRoundTripFeeRateSync(userId);

  let accounts;
  try {
    accounts = await fetchBithumbAccountsWithCredentials(
      /** @type {import("./bithumb-trading-adapter.js").BithumbCredentials} */ (
        credentials
      ),
    );
  } catch {
    return [];
  }

  const store = readStoreSync();

  /** @type {{ programId: string; symbol: string; name: string; quantity: number; avgEntryPrice: number }[]} */
  const rows = [];
  for (const acc of accounts) {
    const base = String(acc.currency ?? "").trim().toUpperCase();
    const qty =
      Number(acc.balance ?? 0) + Number(acc.locked ?? 0);
    if (!base || base === "KRW" || !Number.isFinite(qty) || qty <= 0) continue;

    const symbol = bithumbBaseToUsdtSymbol(base);
    if (!symbol) continue;

    const program = pickArmedProgramForSymbol(armedCrypto, symbol, store);
    if (!program) continue;

    const { positions: programOpen } = buildPositionsFromTrades(
      store.trades,
      program.id,
    );
    const ledgerPos = programOpen.find(
      (p) => p.market === "crypto" && p.symbol === symbol,
    );
    if (overlayOnly && ledgerPos) {
      continue;
    }
    if (!ledgerPos) {
      continue;
    }

    const avgRaw = Number(acc.avg_buy_price);
    const avgEntry =
      Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : null;

    rows.push({
      programId: program.id,
      symbol,
      name: cryptoYahooUsdtDisplayName(symbol),
      quantity: qty,
      avgEntryPrice: avgEntry,
      ledgerPos,
    });
  }

  if (!rows.length) return [];

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const quotes = await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 });

  /** @type {object[]} */
  const out = [];
  for (const row of rows) {
    const q = pickQuoteFromMap(quotes, row.symbol, "crypto");
    const currentPrice =
      q?.price != null && Number.isFinite(q.price) && q.price > 0
        ? q.price
        : null;
    const metrics = applyProgramLedgerToBithumbHoldingMetrics(
      row.quantity,
      row.avgEntryPrice,
      row.ledgerPos,
    );
    if (!(metrics.quantity > 1e-9)) continue;

    const avgEntry =
      metrics.avgEntry > 0 ? metrics.avgEntry : (currentPrice ?? 0);
    const costBasis = metrics.costBasis;
    const quantity = metrics.quantity;
    const mv =
      currentPrice != null ? currentPrice * quantity : null;
    if (mv != null && mv < MIN_DISPLAY_KRW) continue;

    const grossPct =
      mv != null ? holdingGrossReturnPctFromCost(costBasis, mv) : null;
    const netPct =
      mv != null
        ? holdingNetReturnPctFromCost(costBasis, mv, feeRate)
        : null;

    const exit = await resolveCryptoHoldingExitTargets(
      row.programId,
      row.symbol,
      avgEntry > 0 ? avgEntry : currentPrice,
      userId,
      store,
    );

    out.push({
      programId: row.programId,
      symbol: row.symbol,
      name: row.name,
      market: "crypto",
      quantity,
      avgEntryPrice: avgEntry,
      costBasis,
      currentPrice,
      marketValue: mv,
      unrealizedPnl: mv != null && costBasis > 0 ? mv - costBasis : null,
      changePct: netPct,
      grossChangePct: grossPct,
      targetSellPrice: exit.targetSellPrice,
      stopLossPrice: exit.stopLossPrice,
      exitScenarioNote: exit.exitScenarioNote,
      entryStructureNote: exit.entryStructureNote,
      entryIdeal: exit.entryIdeal,
      currency: liveTradeCurrency("crypto"),
      openedAtMs: Date.now(),
      lastAtMs: Date.now(),
      quoteQuotedAtMs:
        typeof q?.quotedAtMs === "number" && q.quotedAtMs > 0
          ? q.quotedAtMs
          : null,
      priceSource:
        q?.priceSource === "over" ||
        q?.priceSource === "regular" ||
        q?.priceSource === "1m"
          ? q.priceSource
          : null,
      exchangeSource: "bithumb",
    });
  }
  return out;
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
/** 거래소 잔고 전체 → 보유 행(앱 기록과 무관, 실매매 동기화용) */
export async function listBithumbExchangeBalanceHoldings(programs) {
  /** @type {Map<string, import("./live-trade-programs-store.js").LiveTradeProgram[]>} */
  const byUser = new Map();
  for (const p of programs) {
    const uid = String(p.userId ?? "").trim();
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(p);
  }
  const out = [];
  for (const [userId, userPrograms] of byUser) {
    const creds = getDecryptedCredentialsSync(userId, "bithumb");
    if (!creds) continue;
    const rows = await listBithumbExchangeOverlayRowsForCredentials(
      userPrograms,
      creds,
      userId,
      { overlayOnly: false },
    );
    out.push(...rows);
  }
  return out;
}

/**
 * 가동 중 실매매 카드 — 빗썸 잔고 API 기준으로 crypto 보유를 덮어씀
 * @param {object} snap
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
export async function refreshCryptoHoldingsFromExchange(snap, programs) {
  const armedCrypto = programs.filter(isArmedCryptoProgram);
  if (!armedCrypto.length || !snap) return snap;

  const armedIds = new Set(armedCrypto.map((p) => p.id));
  const filterPid = snap.programId ? String(snap.programId).trim() : null;

  let fromExchange = await listBithumbExchangeBalanceHoldings(programs);
  if (filterPid) {
    fromExchange = fromExchange.filter((h) => h.programId === filterPid);
  }

  const kept = (snap.holdings ?? []).filter((h) => {
    if (h.market !== "crypto") return true;
    if (filterPid && h.programId !== filterPid) return true;
    return !armedIds.has(h.programId);
  });

  snap.holdings = [...kept, ...fromExchange].sort(
    (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0),
  );
  snap.summary.holdingCount = snap.holdings.length;

  let investedOpen = 0;
  let marketValueOpen = 0;
  for (const h of snap.holdings) {
    if (h.costBasis != null && Number.isFinite(h.costBasis)) {
      investedOpen += h.costBasis;
    }
    if (h.marketValue != null && Number.isFinite(h.marketValue)) {
      marketValueOpen += h.marketValue;
    }
  }
  const unrealizedPnl = marketValueOpen - investedOpen;
  snap.summary.investedOpen = investedOpen;
  snap.summary.marketValueOpen = marketValueOpen;
  snap.summary.unrealizedPnl = unrealizedPnl;
  snap.summary.totalPnl = snap.summary.realizedPnl + unrealizedPnl;
  const closedCost = (snap.trades ?? [])
    .filter((t) => t.side === "sell")
    .reduce((s, t) => s + t.amount, 0);
  const denom = investedOpen + closedCost;
  snap.summary.totalReturnPct =
    denom > 0
      ? (snap.summary.totalPnl / denom) * 100
      : investedOpen > 0
        ? (unrealizedPnl / investedOpen) * 100
        : null;

  return snap;
}

export async function listBithumbExchangeOverlayRows(programs) {
  /** @type {Map<string, import("./live-trade-programs-store.js").LiveTradeProgram[]>} */
  const byUser = new Map();
  for (const p of programs) {
    const uid = String(p.userId ?? "").trim();
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(p);
  }
  const out = [];
  for (const [userId, userPrograms] of byUser) {
    const creds = getDecryptedCredentialsSync(userId, "bithumb");
    if (!creds) continue;
    const rows = await listBithumbExchangeOverlayRowsForCredentials(
      userPrograms,
      creds,
      userId,
    );
    out.push(...rows);
  }
  return out;
}

/**
 * @param {object} snap — buildLiveTradePortfolioSnapshot 결과
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
export async function mergeBithumbExchangeHoldings(snap, programs) {
  const overlay = await listBithumbExchangeOverlayRows(programs);
  if (!overlay.length) return snap;

  const filterPid = snap.programId ? String(snap.programId).trim() : null;
  const toAdd = filterPid
    ? overlay.filter((h) => h.programId === filterPid)
    : overlay;

  if (!toAdd.length) return snap;

  const keys = new Set(
    snap.holdings.map((h) => `${h.programId}:${h.symbol}`),
  );
  for (const h of toAdd) {
    const k = `${h.programId}:${h.symbol}`;
    if (keys.has(k)) continue;
    snap.holdings.push(h);
    keys.add(k);
    if (h.costBasis != null) snap.summary.investedOpen += h.costBasis;
    if (h.marketValue != null) snap.summary.marketValueOpen += h.marketValue;
  }

  snap.holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
  snap.summary.holdingCount = snap.holdings.length;
  const unrealizedPnl =
    snap.summary.marketValueOpen - snap.summary.investedOpen;
  snap.summary.unrealizedPnl = unrealizedPnl;
  snap.summary.totalPnl = snap.summary.realizedPnl + unrealizedPnl;
  const closedCost = snap.trades
    .filter((t) => t.side === "sell")
    .reduce((s, t) => s + t.amount, 0);
  const denom = snap.summary.investedOpen + closedCost;
  snap.summary.totalReturnPct =
    denom > 0
      ? (snap.summary.totalPnl / denom) * 100
      : snap.summary.investedOpen > 0
        ? (unrealizedPnl / snap.summary.investedOpen) * 100
        : null;

  return snap;
}

/**
 * @param {Record<string, { totalReturnPct: number | null; holdingCount: number }>} out
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram[]} programs
 */
export async function applyBithumbExchangeToProgramReturns(out, programs) {
  const overlay = await listBithumbExchangeOverlayRows(programs);
  if (!overlay.length) return out;

  const symbols = [...new Set(overlay.map((h) => h.symbol))];
  const quotes = await fetchQuoteSnapshotsForSymbols(symbols, { maxAgeMs: 0 });

  /** @type {Map<string, import("./live-trade-programs-store.js").LiveTradeProgram>} */
  const programById = new Map(programs.map((p) => [p.id, p]));

  for (const h of overlay) {
    const pid = h.programId;
    if (!out[pid]) out[pid] = { totalReturnPct: null, holdingCount: 0 };

    const program = programById.get(pid);
    const feeRate = getBithumbRoundTripFeeRateSync(program?.userId ?? "");

    const q = pickQuoteFromMap(quotes, h.symbol, "crypto");
    const cp =
      q?.price != null && Number.isFinite(q.price) && q.price > 0
        ? q.price
        : null;
    const avg = h.avgEntryPrice > 0 ? h.avgEntryPrice : cp;
    const mv = cp != null ? cp * h.quantity : h.marketValue;
    const cost = avg != null && avg > 0 ? avg * h.quantity : 0;

    out[pid].holdingCount += 1;

    if (cp != null && avg != null && avg > 0 && cost > 0 && mv != null) {
      const pnl = mv - cost;
      if (!out[pid]._exchPnl) out[pid]._exchPnl = 0;
      if (!out[pid]._exchCost) out[pid]._exchCost = 0;
      out[pid]._exchPnl += pnl;
      out[pid]._exchCost += cost;
    }
  }
  for (const pid of Object.keys(out)) {
    const exchCost = out[pid]._exchCost ?? 0;
    const exchPnl = out[pid]._exchPnl ?? 0;
    delete out[pid]._exchPnl;
    delete out[pid]._exchCost;
    if (!(exchCost > 0)) continue;

    const program = programById.get(pid);
    const feeRate = getBithumbRoundTripFeeRateSync(program?.userId ?? "");
    const overlayPct = netReturnPct(1, 1 + exchPnl / exchCost, feeRate);
    const prev = out[pid].totalReturnPct;
    if (prev == null || !Number.isFinite(prev)) {
      out[pid].totalReturnPct = overlayPct;
    }
  }
  return out;
}
