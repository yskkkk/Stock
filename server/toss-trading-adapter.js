/**
 * 토스증권 Open API 어댑터 — 회원별 API 키 또는 서버 env.
 */
import { normalizeLiveTradeMarket, programAllowsMarket } from "./live-trade-market.js";
import { getProgramArmedMarkets } from "./live-trade-arm-gate.js";
import {
  meetsTelegramNotifyScore,
  resolvePickWeightedScoreBreakdown,
} from "./technical.js";
import { isBoxRangePickSignal } from "./box-range/buy-guard.js";
import { isBoxRangeProgram } from "./box-range/constants.js";
import { getDecryptedCredentialsSync } from "./user-credentials-store.js";
import { loadStock } from "./stock-data.js";
import {
  buildTossOrderCreateBody,
  parseTossOrderIdFromResponse,
  tossOrderSymbol,
} from "./toss-order-body.js";
import {
  cancelTossOrderRaw,
  fetchTossOpenOrdersRaw,
  fetchTossSellableQuantityRaw,
  issueTossAccessToken,
  resolveTossAccountSeq,
  tossOpenApiPost,
  tossOpenApiBaseUrl,
} from "./toss-openapi.js";
import { rejectIfVirtualUserLiveOrder } from "./virtual-user-order-guard.js";

/** 국내 주식 실매매 자동매도 파이프라인(스크리너) 지원 여부 */
export const KR_LIVE_AUTO_SELL_SUPPORTED = false;

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 */
export function assertKrLiveBuyAutoSellInterlock(program) {
  const armed = getProgramArmedMarkets(program);
  if (!armed.kr || program?.status !== "armed") return null;

  const autoSellOn = program.autoSellAtTarget !== false;
  if (!autoSellOn) {
    const reason = "자동 매도가 꺼져 있어 국내 실매매 매수를 차단했습니다.";
    console.warn("[toss-trading] KR live buy interlock:", program.name ?? program.id, {
      armedKr: true,
      autoSellOn: false,
      krAutoSellSupported: KR_LIVE_AUTO_SELL_SUPPORTED,
    });
    return { code: "KR_AUTO_SELL_INTERLOCK", message: reason };
  }
  if (!KR_LIVE_AUTO_SELL_SUPPORTED) {
    const reason =
      "국내 주식 실매매 자동매도가 아직 지원되지 않아 매수를 차단했습니다. (운영 실수 방지 인터록)";
    console.warn("[toss-trading] KR live buy interlock:", program.name ?? program.id, {
      armedKr: true,
      autoSellOn: true,
      krAutoSellSupported: false,
    });
    return { code: "KR_AUTO_SELL_INTERLOCK", message: reason };
  }
  return null;
}

/** @typedef {"unconfigured" | "configured" | "ready"} TossApiPhase */

function tossApiKey() {
  return String(process.env.TOSS_API_KEY ?? "").trim();
}

function tossApiSecret() {
  return String(process.env.TOSS_API_SECRET ?? "").trim();
}

function tossAccountId() {
  return String(process.env.TOSS_ACCOUNT_ID ?? "").trim();
}

function tossApiBase() {
  return String(process.env.TOSS_API_BASE_URL ?? "").trim();
}

/**
 * @param {string} [userId]
 */
function resolveTossCredentials(userId) {
  const uid = String(userId ?? "").trim();
  if (uid) {
    try {
      const creds = getDecryptedCredentialsSync(uid, "toss");
      const apiKey = String(creds?.apiKey ?? "").trim();
      const accountId = String(creds?.accountId ?? "").trim();
      if (apiKey) {
        return {
          apiKey,
          secret: String(creds?.secretKey ?? "").trim(),
          accountId,
          source: "user",
        };
      }
    } catch {
      /* env fallback */
    }
  }
  return {
    apiKey: tossApiKey(),
    secret: tossApiSecret(),
    accountId: tossAccountId(),
    source: "env",
  };
}

export function getTossApiPhase() {
  if (!tossApiKey()) return "unconfigured";
  if (!tossApiSecret()) return "configured";
  return "ready";
}

export function isTossTradingReady() {
  return getTossApiPhase() === "ready";
}

export function getTossTradingStatus() {
  const phase = getTossApiPhase();
  const configured = phase !== "unconfigured";
  const ready = phase === "ready";
  let messageKo = "토스 API 키가 아직 등록되지 않았습니다.";
  if (phase === "configured") {
    messageKo =
      "API Key는 등록됐습니다. Secret Key를 추가하면 연동할 수 있습니다.";
  } else if (ready) {
    messageKo =
      "토스 API 연동 준비됨. 프로그램 조건에 맞으면 주문 파이프라인으로 전달됩니다.";
  }
  return {
    phase,
    configured,
    ready,
    messageKo,
    hasSecret: Boolean(tossApiSecret()),
    hasAccount: Boolean(tossAccountId()),
    baseUrl: tossApiBase() || null,
    docsHint: "https://docs.tossinvest.com",
    source: "env",
  };
}

/**
 * @param {string} userId
 */
export function getTossTradingStatusForUser(userId) {
  const creds = resolveTossCredentials(userId);
  if (!creds.apiKey) return getTossTradingStatus();
  if (!creds.secret) {
    return {
      phase: "configured",
      configured: true,
      ready: false,
      messageKo:
        "토스 API Key는 등록됐습니다. Secret Key를 함께 저장하세요.",
      hasSecret: false,
      hasAccount: Boolean(creds.accountId),
      baseUrl: tossApiBase() || tossOpenApiBaseUrl(),
      docsHint: "https://openapi.tossinvest.com",
      source: creds.source,
    };
  }
  return {
    phase: "ready",
    configured: true,
    ready: true,
    messageKo: creds.accountId
      ? "회원 토스 API 연동 준비됨."
      : "회원 토스 API 연동 준비됨 · accountSeq는 첫 조회 시 자동 저장됩니다.",
    hasSecret: true,
    hasAccount: Boolean(creds.accountId),
    baseUrl: tossApiBase() || tossOpenApiBaseUrl(),
    docsHint: "https://openapi.tossinvest.com",
    source: creds.source,
  };
}

function tossReadyForUser(userId) {
  const creds = resolveTossCredentials(userId);
  return Boolean(creds.apiKey && creds.secret);
}

/**
 * @param {string} symbol
 * @param {"kr"|"us"} market
 * @param {number} amount
 * @param {"market"|"limit"} orderType
 * @param {number | undefined} limitPrice
 */
async function resolveManualBuyQuantity(symbol, market, amount, orderType, limitPrice) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new Error("매수 금액을 입력하세요.");
  }
  if (market === "us" && orderType === "market") return undefined;
  if (orderType === "limit") {
    const p = Number(limitPrice);
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error("지정가를 입력하세요.");
    }
    return Math.max(1, Math.floor(amt / p));
  }
  const data = await loadStock(symbol, "1d", { live: true });
  let cp = Number(data?.quote?.price ?? data?.quote?.regularMarketPrice);
  if (!Number.isFinite(cp) || cp <= 0) {
    const last = Number(data?.candles?.at(-1)?.close);
    if (Number.isFinite(last) && last > 0) cp = last;
  }
  if (!Number.isFinite(cp) || cp <= 0) {
    throw new Error("현재가를 확인할 수 없어 매수 수량을 계산하지 못했습니다.");
  }
  return Math.max(1, Math.floor(amt / cp));
}

/**
 * @param {string} [userId]
 */
export function isTossLiveOrdersEnabledForUser(userId) {
  if (process.env.TOSS_LIVE_ORDERS_ENABLED !== "1") return false;
  const uid = String(userId ?? "").trim();
  if (uid) {
    const creds = getDecryptedCredentialsSync(uid, "toss");
    if (creds) return Boolean(creds.liveOrdersEnabled);
  }
  return true;
}

/**
 * @param {string} userId
 */
async function resolveTossApiSession(userId) {
  const creds = resolveTossCredentials(userId);
  if (!creds.apiKey || !creds.secret) {
    throw new Error("토스 API Key·Secret Key를 저장하세요.");
  }
  const accessToken = await issueTossAccessToken(creds.apiKey, creds.secret);
  const accountSeq = await resolveTossAccountSeq(accessToken, creds.accountId);
  return { accessToken, accountSeq, creds };
}

/**
 * @param {string} accessToken
 * @param {string} accountSeq
 * @param {Record<string, unknown>} body
 */
async function submitTossOrder(accessToken, accountSeq, body) {
  const blocked = rejectIfVirtualUserLiveOrder();
  if (blocked) throw new Error(blocked.error);
  const json = await tossOpenApiPost(accessToken, accountSeq, "/api/v1/orders", body);
  const orderId = parseTossOrderIdFromResponse(json);
  if (!orderId) {
    throw new Error("토스에서 주문 ID를 받지 못했습니다.");
  }
  const result =
    json?.result && typeof json.result === "object" ? json.result : json;
  return {
    orderId,
    fillPrice:
      typeof result?.averagePrice === "number" && Number.isFinite(result.averagePrice)
        ? result.averagePrice
        : undefined,
    raw: result,
  };
}

/**
 * @typedef {{
 *   apiKey: string;
 *   secretKey: string;
 *   accountId?: string;
 *   liveOrdersEnabled?: boolean;
 * }} TossTradingCredentials
 */

/**
 * @param {TossTradingCredentials} credentials
 */
export async function listTossOpenOrdersWithCredentials(credentials) {
  const apiKey = String(credentials?.apiKey ?? "").trim();
  const secretKey = String(credentials?.secretKey ?? "").trim();
  if (!apiKey || !secretKey) {
    throw new Error("토스 API Key·Secret Key가 필요합니다.");
  }
  const accessToken = await issueTossAccessToken(apiKey, secretKey);
  const accountSeq = await resolveTossAccountSeq(accessToken, credentials?.accountId);
  return fetchTossOpenOrdersRaw(accessToken, accountSeq);
}

/**
 * @param {string} orderId
 * @param {TossTradingCredentials} credentials
 */
export async function cancelTossOrderWithCredentials(orderId, credentials) {
  const apiKey = String(credentials?.apiKey ?? "").trim();
  const secretKey = String(credentials?.secretKey ?? "").trim();
  if (!apiKey || !secretKey) {
    throw new Error("토스 API Key·Secret Key가 필요합니다.");
  }
  const accessToken = await issueTossAccessToken(apiKey, secretKey);
  const accountSeq = await resolveTossAccountSeq(accessToken, credentials?.accountId);
  await cancelTossOrderRaw(accessToken, accountSeq, orderId);
}

/**
 * @param {string} userId
 * @param {string} symbol
 * @param {"kr"|"us"} market
 */
export async function fetchTossSellableQuantityForUser(userId, symbol, market) {
  const { accessToken, accountSeq } = await resolveTossApiSession(userId);
  const orderSymbol = tossOrderSymbol(symbol, market);
  const raw = await fetchTossSellableQuantityRaw(
    accessToken,
    accountSeq,
    orderSymbol,
    market === "us" ? "US" : "KR",
  );
  const qty = Number(raw?.quantity ?? raw?.sellableQuantity ?? raw?.qty);
  return Number.isFinite(qty) && qty >= 0 ? qty : 0;
}

/**
 * @param {string} userId
 * @param {{
 *   symbol: string;
 *   market?: string;
 *   side: "buy" | "sell";
 *   orderType?: "market" | "limit";
 *   amount?: number;
 *   quantity?: number;
 *   price?: number;
 * }} order
 */
export async function placeManualTossOrderForUser(userId, order) {
  const blocked = rejectIfVirtualUserLiveOrder();
  if (blocked) return blocked;
  const uid = String(userId ?? "").trim();
  if (!uid) return { ok: false, error: "로그인이 필요합니다." };
  if (!tossReadyForUser(uid)) {
    const status = getTossTradingStatusForUser(uid);
    return { ok: false, error: status.messageKo };
  }

  const symbol = String(order.symbol ?? "").trim();
  const market = normalizeLiveTradeMarket(order.market, symbol);
  if (market === "crypto") {
    return { ok: false, error: "코인은 토스 실주문을 지원하지 않습니다." };
  }
  const side = String(order.side ?? "").trim().toLowerCase();
  if (side !== "buy" && side !== "sell") {
    return { ok: false, error: "매수·매도 구분이 올바르지 않습니다." };
  }
  const orderTypeRaw = String(order.orderType ?? "market").trim().toLowerCase();
  const orderSymbol = tossOrderSymbol(symbol, market);
  if (!orderSymbol) {
    return { ok: false, error: "종목 코드가 올바르지 않습니다." };
  }

  const live = isTossLiveOrdersEnabledForUser(uid);
  if (!live) {
    return {
      ok: false,
      error:
        "실주문이 꺼져 있습니다. «토스 API 연동»에서 «실주문 허용»을 켜고 서버 TOSS_LIVE_ORDERS_ENABLED=1을 확인하세요.",
    };
  }

  try {
    const { accessToken, accountSeq } = await resolveTossApiSession(uid);
    let body;
    if (side === "buy") {
      const amount = Number(order.amount);
      const quantity = await resolveManualBuyQuantity(
        symbol,
        market,
        amount,
        orderTypeRaw,
        order.price != null ? Number(order.price) : undefined,
      );
      body = buildTossOrderCreateBody({
        symbol,
        market,
        side: "buy",
        orderType: orderTypeRaw,
        quantity,
        amount,
        price: order.price != null ? Number(order.price) : undefined,
        clientOrderId: `manual-${orderSymbol}-buy-${Date.now()}`,
      });
    } else {
      body = buildTossOrderCreateBody({
        symbol,
        market,
        side: "sell",
        orderType: orderTypeRaw,
        quantity: Number(order.quantity),
        price: order.price != null ? Number(order.price) : undefined,
        clientOrderId: `manual-${orderSymbol}-sell-${Date.now()}`,
      });
    }

    const placed = await submitTossOrder(accessToken, accountSeq, body);
    void import("./live-trade-toss-ledger.js")
      .then((m) => m.refreshTossLedgerSnapshotForUserAsync(uid))
      .catch(() => null);
    return {
      ok: true,
      orderId: placed.orderId,
      fillPrice: placed.fillPrice,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {{ score: number; signalIds?: string[]; techModelWeights?: Record<string, number> }} pick
 */
export function pickMeetsProgramThreshold(program, pick) {
  const ratio =
    typeof program.minScoreRatio === "number" && Number.isFinite(program.minScoreRatio)
      ? Math.min(1, Math.max(0.5, program.minScoreRatio))
      : 0.8;
  const { score, maxScore, weights } = resolvePickWeightedScoreBreakdown({
    ...pick,
    techModelId: pick.techModelId ?? program.modelId,
  });
  if (!weights || typeof weights !== "object" || Object.keys(weights).length === 0) {
    return false;
  }
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
    return false;
  }
  if (score > maxScore) return false;
  return meetsTelegramNotifyScore(score, weights, ratio);
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 * @param {{ userId?: string }} [opts]
 */
export async function executeLiveBuyOrder(program, pick, opts = {}) {
  const blocked = rejectIfVirtualUserLiveOrder();
  if (blocked) return blocked;
  const userId = String(opts.userId ?? program.userId ?? "").trim();
  if (!tossReadyForUser(userId)) {
    const status = getTossTradingStatusForUser(userId);
    return { ok: false, error: status.messageKo };
  }

  if (
    !isBoxRangePickSignal(pick) &&
    !pickMeetsProgramThreshold(program, pick)
  ) {
    return { ok: false, error: "점수 조건을 충족하지 않습니다." };
  }

  if (!isBoxRangeProgram(program) && !isBoxRangePickSignal(pick)) {
    const interlock = assertKrLiveBuyAutoSellInterlock(program);
    if (interlock) {
      return { ok: false, success: false, error: interlock.message, code: interlock.code };
    }
  }

  const symbol = String(pick.symbol ?? "").trim();
  const market = normalizeLiveTradeMarket(pick.market, symbol);
  if (market === "crypto") {
    return {
      ok: false,
      error: "코인은 토스 실주문을 지원하지 않습니다. 시뮬레이션을 이용하세요.",
    };
  }
  if (!programAllowsMarket(program, market)) {
    return { ok: false, error: "이 프로그램에서 허용하지 않는 시장입니다." };
  }

  const amount =
    market === "kr" ? program.orderAmountKrw : program.orderAmountUsd;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "주문 금액을 설정하세요." };
  }

  const creds = resolveTossCredentials(userId);

  if (!isTossLiveOrdersEnabledForUser(userId)) {
    console.info(
      "[toss-trading] simulated buy",
      program.name,
      symbol,
      market,
      amount,
      creds.source,
    );
    return {
      ok: true,
      simulated: true,
      orderId: `sim-${Date.now()}`,
    };
  }

  try {
    const { accessToken, accountSeq } = await resolveTossApiSession(userId);
    const orderSymbol = tossOrderSymbol(symbol, market);
    let body;
    if (market === "us") {
      body = buildTossOrderCreateBody({
        symbol,
        market,
        side: "buy",
        orderType: "market",
        amount,
        clientOrderId: `${program.id}-${orderSymbol}-${Date.now()}`,
      });
    } else {
      const quantity = await resolveManualBuyQuantity(symbol, market, amount, "market", undefined);
      body = buildTossOrderCreateBody({
        symbol,
        market,
        side: "buy",
        orderType: "market",
        quantity,
        clientOrderId: `${program.id}-${orderSymbol}-${Date.now()}`,
      });
    }
    const placed = await submitTossOrder(accessToken, accountSeq, body);
    return {
      ok: true,
      orderId: placed.orderId,
      fillPrice: placed.fillPrice,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {{ symbol: string; market: string; quantity: number; price?: number }} order
 * @param {{ userId?: string }} [opts]
 */
export async function executeLiveSellOrder(program, order, opts = {}) {
  const blocked = rejectIfVirtualUserLiveOrder();
  if (blocked) return blocked;
  const userId = String(opts.userId ?? program.userId ?? "").trim();
  if (!tossReadyForUser(userId)) {
    const status = getTossTradingStatusForUser(userId);
    return { ok: false, error: status.messageKo };
  }

  const symbol = String(order.symbol ?? "").trim();
  const market = normalizeLiveTradeMarket(order.market, symbol);
  const quantity = Number(order.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: "매도 수량이 올바르지 않습니다." };
  }
  if (market === "crypto") {
    return { ok: false, error: "코인은 토스 실주문을 지원하지 않습니다." };
  }
  if (!programAllowsMarket(program, market)) {
    return { ok: false, error: "이 프로그램에서 허용하지 않는 시장입니다." };
  }

  const creds = resolveTossCredentials(userId);
  const price =
    typeof order.price === "number" && Number.isFinite(order.price)
      ? order.price
      : undefined;

  if (!isTossLiveOrdersEnabledForUser(userId)) {
    console.info(
      "[toss-trading] simulated sell",
      program.name,
      symbol,
      market,
      quantity,
      creds.source,
    );
    return {
      ok: true,
      simulated: true,
      orderId: `sim-sell-${Date.now()}`,
      fillPrice: price,
    };
  }

  try {
    const { accessToken, accountSeq } = await resolveTossApiSession(userId);
    const body = buildTossOrderCreateBody({
      symbol,
      market,
      side: "sell",
      orderType: price != null ? "limit" : "market",
      quantity,
      price,
      clientOrderId: `${program.id}-${tossOrderSymbol(symbol, market)}-sell-${Date.now()}`,
    });
    const placed = await submitTossOrder(accessToken, accountSeq, body);
    return {
      ok: true,
      orderId: placed.orderId,
      fillPrice: placed.fillPrice ?? price,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
