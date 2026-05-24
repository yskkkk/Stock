/**
 * 빗썸 거래소 잔고 ↔ 앱 보유 기록 동기화
 * — 거래소에 없는데 앱에 열린 포지션이 있으면 체결 조회 후 매도 기록
 */
import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";
import {
  fetchBithumbAccountsWithCredentials,
  fetchBithumbOrderWithCredentials,
  listBithumbDoneOrdersWithCredentials,
} from "./bithumb-trading-adapter.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { listLiveTradeProgramsSync } from "./live-trade-programs-store.js";
import {
  buildPositionsFromTrades,
  readStoreSync,
  recordLiveTradeSellSync,
} from "./live-trade-portfolio-store.js";
import { normalizeSellQuantity } from "./live-trade-market.js";

/** @typedef {import("./bithumb-trading-adapter.js").BithumbCredentials} BithumbCredentials */

const QTY_EPS = 1e-8;
/** 거래소 수량이 앱 대비 이 비율 미만이면 '보유 없음' */
export const EXCHANGE_ZERO_RATIO = 0.02;

/**
 * @param {unknown[]} accounts
 * @returns {{ total: Map<string, number>; available: Map<string, number> }}
 */
export function bithumbAccountQtyMapsFromAccounts(accounts) {
  /** @type {Map<string, number>} */
  const total = new Map();
  /** @type {Map<string, number>} */
  const available = new Map();
  const list = Array.isArray(accounts) ? accounts : [];
  for (const a of list) {
    const base = String(a?.currency ?? "").trim().toUpperCase();
    if (!base || base === "KRW") continue;
    const avail = Number(a?.balance ?? 0);
    const locked = Number(a?.locked ?? 0);
    if (!Number.isFinite(avail) || !Number.isFinite(locked)) continue;
    const qty = avail + locked;
    if (qty > 0) total.set(base, qty);
    if (avail > 0) available.set(base, avail);
  }
  return { total, available };
}

/**
 * @param {import("./bithumb-trading-adapter.js").BithumbCredentials} credentials
 * @returns {Promise<{ total: Map<string, number>; available: Map<string, number> }>}
 */
export async function getBithumbExchangeQtyMaps(credentials) {
  const accounts = await fetchBithumbAccountsWithCredentials(credentials);
  return bithumbAccountQtyMapsFromAccounts(accounts);
}

/**
 * @param {import("./bithumb-trading-adapter.js").BithumbCredentials} credentials
 * @returns {Promise<Map<string, number>>} base currency → total qty (balance + locked)
 */
export async function getBithumbExchangeBaseQtyMap(credentials) {
  return (await getBithumbExchangeQtyMaps(credentials)).total;
}

/**
 * 앱 보유 수량을 빗썸 주문 가능(balance) 수량 이하로 맞춤.
 * @param {number} appQuantity
 * @param {number} availableQuantity
 * @returns {{ volume: number; clamped: boolean }}
 */
export function clampBithumbSellVolumeToAvailable(appQuantity, availableQuantity) {
  const app = Number(appQuantity);
  const avail = Number(availableQuantity);
  if (!Number.isFinite(app) || app <= 0) return { volume: 0, clamped: false };
  if (!Number.isFinite(avail) || avail <= 0) return { volume: 0, clamped: false };
  const volume = normalizeSellQuantity(Math.min(app, avail), "crypto");
  if (volume <= 0) return { volume: 0, clamped: false };
  return { volume, clamped: volume + 1e-8 < app };
}

/**
 * @param {BithumbCredentials} credentials
 * @param {string} market e.g. KRW-BTC
 * @param {{ limit?: number }} [opts]
 */
export async function listBithumbDoneOrdersForMarket(
  credentials,
  market,
  opts = {},
) {
  return listBithumbDoneOrdersWithCredentials(credentials, market, opts);
}

/**
 * @param {object} order
 * @returns {{ price: number; volume: number; funds: number; atMs: number; orderId: string } | null}
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
  return { price, volume, funds, atMs, orderId };
}

/**
 * @param {object[]} orders newest first
 * @param {number} openedAtMs
 */
export function findAskFillAfter(orders, openedAtMs) {
  for (const o of orders) {
    if (String(o?.side ?? "").toLowerCase() !== "ask") continue;
    const fill = parseDoneOrderFill(o);
    if (!fill) continue;
    if (fill.atMs < openedAtMs) break;
    if (fill.atMs >= openedAtMs) return fill;
  }
  return null;
}

/**
 * @param {string} userId
 * @param {{ dryRun?: boolean; programId?: string }} [opts]
 */
export async function reconcileBithumbHoldingsForUser(userId, opts = {}) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  if (!credentials?.apiKey || !credentials?.secretKey) {
    throw new Error("빗썸 API 키가 없습니다.");
  }

  const dryRun = Boolean(opts.dryRun);
  const filterPid = opts.programId ? String(opts.programId).trim() : null;

  const programs = listLiveTradeProgramsSync(uid).filter(
    (p) =>
      p.markets?.crypto &&
      (p.status === "armed" || p.status === "sim") &&
      (!filterPid || p.id === filterPid),
  );

  const exchangeQty = await getBithumbExchangeBaseQtyMap(credentials);

  const store = readStoreSync();
  /** @type {Array<object>} */
  const actions = [];
  /** @type {Array<object>} */
  const recorded = [];

  for (const program of programs) {
    const { positions } = buildPositionsFromTrades(store.trades, program.id);
    for (const pos of positions) {
      if (pos.market !== "crypto") continue;
      const base = usdtSymbolToBithumbBase(pos.symbol);
      if (!base) continue;
      const exQty = exchangeQty.get(base) ?? 0;
      if (exQty >= pos.quantity * EXCHANGE_ZERO_RATIO) {
        actions.push({
          programId: program.id,
          programName: program.name,
          symbol: pos.symbol,
          status: "held",
          appQty: pos.quantity,
          exchangeQty: exQty,
        });
        continue;
      }

      const market = `KRW-${base}`;
      let orders = [];
      try {
        orders = await listBithumbDoneOrdersWithCredentials(credentials, market, {
          limit: 100,
        });
      } catch (e) {
        actions.push({
          programId: program.id,
          symbol: pos.symbol,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const fill = findAskFillAfter(orders, pos.openedAtMs);
      const sellQty = pos.quantity;
      const sellPrice = fill?.price ?? null;
      const orderId = fill?.orderId ?? null;
      const atMs = fill?.atMs ?? Date.now();
      const entryAvg = pos.quantity > 0 ? pos.costBasis / pos.quantity : 0;
      const returnPct =
        sellPrice != null && entryAvg > 0
          ? ((sellPrice - entryAvg) / entryAvg) * 100
          : null;

      const action = {
        programId: program.id,
        programName: program.name,
        symbol: pos.symbol,
        status: "closed_on_exchange",
        appQty: sellQty,
        exchangeQty: exQty,
        sellPrice,
        entryAvg,
        returnPct,
        orderId,
        atMs,
        dryRun,
      };
      actions.push(action);

      if (dryRun || sellPrice == null) continue;

      try {
        const trade = recordLiveTradeSellSync(
          {
            programId: program.id,
            symbol: pos.symbol,
            market: "crypto",
            quantity: sellQty,
            price: sellPrice,
            orderId,
            atMs,
            simulated: false,
            note: orderId
              ? `빗썸 잔고 동기화·체결 ${orderId}`
              : "빗썸 잔고 동기화",
          },
          uid,
        );
        recorded.push({ ...action, tradeId: trade.id, amount: trade.amount });
      } catch (e) {
        action.status = "record_failed";
        action.error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return {
    ok: true,
    dryRun,
    programsChecked: programs.length,
    actions,
    recorded,
  };
}

/** 단일 주문 uuid 상세 (디버그·수동 보정) */
export async function fetchBithumbOrderDetailForUser(userId, orderId) {
  const creds = getDecryptedCredentialsSync(String(userId ?? "").trim(), "bithumb");
  if (!creds) throw new Error("빗썸 API 키가 없습니다.");
  return fetchBithumbOrderWithCredentials(String(orderId ?? "").trim(), creds);
}
