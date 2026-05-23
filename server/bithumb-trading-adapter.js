/**
 * 빗썸 Open API v2 — JWT 인증·시장가 주문 (KRW 마켓).
 * @see https://apidocs.bithumb.com
 */
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  resolveOrderAmountForMarket,
  quantityFromOrderAmount,
} from "./live-trade-market.js";
import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";
import { pickMeetsProgramThreshold } from "./toss-trading-adapter.js";

/** @typedef {"unconfigured" | "configured" | "ready"} BithumbApiPhase */

function bithumbApiKey() {
  return String(process.env.BITHUMB_API_KEY ?? "").trim();
}

function bithumbSecretKey() {
  return String(process.env.BITHUMB_SECRET_KEY ?? "").trim();
}

function bithumbApiBase() {
  return String(
    process.env.BITHUMB_API_BASE_URL ?? "https://api.bithumb.com",
  ).trim();
}

export function getBithumbApiPhase() {
  if (!bithumbApiKey()) return "unconfigured";
  if (!bithumbSecretKey()) return "configured";
  return "ready";
}

export function isBithumbTradingReady() {
  return getBithumbApiPhase() === "ready";
}

export function getBithumbTradingStatus() {
  const phase = getBithumbApiPhase();
  const configured = phase !== "unconfigured";
  const ready = phase === "ready";
  let messageKo =
    "빗썸 API가 없습니다. 프로젝트 루트 .env 에 BITHUMB_API_KEY·BITHUMB_SECRET_KEY 값을 넣고 npm run dev(서버)를 재시작하세요.";
  if (phase === "configured") {
    messageKo =
      "API Key만 있습니다. .env 의 BITHUMB_SECRET_KEY 를 채운 뒤 서버를 재시작하세요.";
  } else if (ready) {
    messageKo =
      "빗썸 연동 준비됨. 코인 실매매 프로그램이 켜져 있으면 조건 충족 시 KRW 시장가 매수가 전달됩니다.";
  }
  return {
    phase,
    configured,
    ready,
    messageKo,
    liveOrdersEnabled: process.env.BITHUMB_LIVE_ORDERS_ENABLED === "1",
    docsHint: "https://apidocs.bithumb.com",
  };
}

/** @param {string} yahooSymbol e.g. BTC-USDT */
export function yahooSymbolToBithumbMarket(yahooSymbol) {
  const base = usdtSymbolToBithumbBase(yahooSymbol);
  return base ? `KRW-${base}` : null;
}

function base64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {Record<string, string | number>} params
 */
/** 빗썸: body 필드 순서 그대로 `k=v&…` — 알파벳 정렬하면 JWT 검증 실패 */
function queryHashSha512(params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
  return crypto.createHash("sha512").update(qs, "utf8").digest("hex");
}

/**
 * @param {Record<string, unknown>} claims
 */
function signJwtHs256(claims, secret) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(claims));
  const data = `${header}.${body}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(data, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${data}.${sig}`;
}

/**
 * @param {"GET"|"POST"|"DELETE"} method
 * @param {string} path e.g. /v1/orders
 * @param {Record<string, string | number> | null} [bodyParams]
 */
async function bithumbPrivateRequest(method, path, bodyParams = null) {
  if (!isBithumbTradingReady()) {
    throw new Error(getBithumbTradingStatus().messageKo);
  }
  const claims = {
    access_key: bithumbApiKey(),
    nonce: randomUUID(),
    timestamp: Date.now(),
  };
  if (bodyParams && Object.keys(bodyParams).length > 0) {
    claims.query_hash = queryHashSha512(bodyParams);
    claims.query_hash_alg = "SHA512";
  }
  const token = signJwtHs256(claims, bithumbSecretKey());
  const url = `${bithumbApiBase().replace(/\/$/, "")}${path}`;
  const init = {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (bodyParams && method !== "GET") {
    init.body = JSON.stringify(bodyParams);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  /** @type {{ error?: { name?: string; message?: string }; uuid?: string }} */
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err =
      body?.error?.message ??
      body?.error?.name ??
      text?.slice(0, 160) ??
      `HTTP ${res.status}`;
    throw new Error(`빗썸 API: ${err}`);
  }
  return body;
}

/**
 * 빗썸 전체 계좌 (보유 코인·원화). Private GET /v1/accounts
 * @returns {Promise<Array<{ currency?: string; balance?: string; locked?: string; avg_buy_price?: string; unit_currency?: string }>>}
 */
export async function fetchBithumbAccounts() {
  if (!isBithumbTradingReady()) return [];
  const body = await bithumbPrivateRequest("GET", "/v1/accounts");
  return Array.isArray(body) ? body : [];
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 * @returns {Promise<{ ok: boolean; simulated?: boolean; orderId?: string; error?: string }>}
 */
export async function executeBithumbLiveBuyOrder(program, pick) {
  const status = getBithumbTradingStatus();
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  if (!pickMeetsProgramThreshold(program, pick)) {
    return { ok: false, error: "점수 조건을 충족하지 않습니다." };
  }

  const symbol = String(pick.symbol ?? "").trim().toUpperCase();
  const market = yahooSymbolToBithumbMarket(symbol);
  if (!market) {
    return { ok: false, error: `빗썸 KRW 마켓이 아닙니다: ${symbol}` };
  }

  const amountKrw = await resolveOrderAmountForMarket(program, "crypto");
  if (amountKrw == null || !Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { ok: false, error: "코인 1회 매수 금액(원)을 설정하세요." };
  }
  const krw = Math.floor(amountKrw);
  if (krw < 5000) {
    return { ok: false, error: "빗썸 최소 주문 금액(약 5,000원) 이상으로 설정하세요." };
  }

  if (process.env.BITHUMB_LIVE_ORDERS_ENABLED !== "1") {
    console.info(
      "[bithumb-trading] simulated buy",
      program.name,
      market,
      krw,
      "score",
      pick.score,
    );
    return { ok: true, simulated: true, orderId: `bithumb-sim-${Date.now()}` };
  }

  try {
    const body = await bithumbPrivateRequest("POST", "/v1/orders", {
      market,
      side: "bid",
      ord_type: "price",
      price: String(krw),
    });
    const orderId = String(body.uuid ?? body.order_id ?? "");
    return { ok: true, orderId: orderId || undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {{ market: string; volume: number }} input
 */
export async function executeBithumbLiveSellOrder(input) {
  const status = getBithumbTradingStatus();
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  const market = String(input.market ?? "").trim();
  const volume = Number(input.volume);
  if (!market || !Number.isFinite(volume) || volume <= 0) {
    return { ok: false, error: "매도 수량이 올바르지 않습니다." };
  }

  if (process.env.BITHUMB_LIVE_ORDERS_ENABLED !== "1") {
    console.info("[bithumb-trading] simulated sell", market, volume);
    return { ok: true, simulated: true, orderId: `bithumb-sim-sell-${Date.now()}` };
  }

  try {
    const vol =
      Math.round(volume * 1e8) / 1e8 > 0
        ? String(Math.round(volume * 1e8) / 1e8)
        : String(volume);
    const body = await bithumbPrivateRequest("POST", "/v1/orders", {
      market,
      side: "ask",
      ord_type: "market",
      volume: vol,
    });
    return { ok: true, orderId: String(body.uuid ?? "") || undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {string} yahooSymbol
 * @param {number} price
 * @param {number} amountKrw
 */
export function estimateBithumbBuyQuantity(yahooSymbol, price, amountKrw) {
  return quantityFromOrderAmount(amountKrw, price, "crypto");
}

/**
 * 시장가 매수 (원화 금액). 테스트·수동 확인용.
 * @param {string} market e.g. KRW-DOGE
 * @param {number} krw
 */
export async function executeBithumbMarketBuyKrw(market, krw) {
  const status = getBithumbTradingStatus();
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  const mk = String(market ?? "").trim();
  const amount = Math.floor(Number(krw));
  if (!mk || !Number.isFinite(amount) || amount < 5000) {
    return {
      ok: false,
      error: "빗썸 최소 주문 금액(약 5,000원) 이상이 필요합니다.",
    };
  }
  if (process.env.BITHUMB_LIVE_ORDERS_ENABLED !== "1") {
    return {
      ok: false,
      error: "BITHUMB_LIVE_ORDERS_ENABLED=0 — 실주문이 꺼져 있습니다.",
    };
  }
  try {
    const body = await bithumbPrivateRequest("POST", "/v1/orders", {
      market: mk,
      side: "bid",
      ord_type: "price",
      price: String(amount),
    });
    return {
      ok: true,
      orderId: String(body.uuid ?? body.order_id ?? "") || undefined,
      market: mk,
      krw: amount,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 시장가 매수 (코인 수량). 최소 주문 금액 미만이면 거래소에서 거절될 수 있음.
 * @param {string} market
 * @param {number} volume
 */
export async function executeBithumbMarketBuyVolume(market, volume) {
  const status = getBithumbTradingStatus();
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  const mk = String(market ?? "").trim();
  const vol = Number(volume);
  if (!mk || !Number.isFinite(vol) || vol <= 0) {
    return { ok: false, error: "수량이 올바르지 않습니다." };
  }
  if (process.env.BITHUMB_LIVE_ORDERS_ENABLED !== "1") {
    return {
      ok: false,
      error: "BITHUMB_LIVE_ORDERS_ENABLED=0 — 실주문이 꺼져 있습니다.",
    };
  }
  try {
    const volStr =
      Math.round(vol * 1e8) / 1e8 > 0
        ? String(Math.round(vol * 1e8) / 1e8)
        : String(vol);
    const body = await bithumbPrivateRequest("POST", "/v1/orders", {
      market: mk,
      side: "bid",
      ord_type: "market",
      volume: volStr,
    });
    return {
      ok: true,
      orderId: String(body.uuid ?? body.order_id ?? "") || undefined,
      market: mk,
      volume: volStr,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
