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

const BITHUMB_API_KEY = String(process.env.BITHUMB_API_KEY ?? "").trim();
const BITHUMB_SECRET_KEY = String(process.env.BITHUMB_SECRET_KEY ?? "").trim();
const BITHUMB_API_BASE = String(
  process.env.BITHUMB_API_BASE_URL ?? "https://api.bithumb.com",
).trim();

/** @typedef {"unconfigured" | "configured" | "ready"} BithumbApiPhase */

export function getBithumbApiPhase() {
  if (!BITHUMB_API_KEY) return "unconfigured";
  if (!BITHUMB_SECRET_KEY) return "configured";
  return "ready";
}

export function isBithumbTradingReady() {
  return getBithumbApiPhase() === "ready";
}

export function getBithumbTradingStatus() {
  const phase = getBithumbApiPhase();
  const configured = phase !== "unconfigured";
  const ready = phase === "ready";
  let messageKo = "빗썸 API 키가 아직 등록되지 않았습니다.";
  if (phase === "configured") {
    messageKo =
      "API Key는 등록됐습니다. Secret Key를 서버 .env에 추가한 뒤 재시작하세요.";
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
function queryHashSha512(params) {
  const entries = Object.entries(params)
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => a.localeCompare(b));
  const qs = new URLSearchParams(entries).toString();
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
    access_key: BITHUMB_API_KEY,
    nonce: randomUUID(),
    timestamp: Date.now(),
  };
  if (bodyParams && Object.keys(bodyParams).length > 0) {
    claims.query_hash = queryHashSha512(bodyParams);
    claims.query_hash_alg = "SHA512";
  }
  const token = signJwtHs256(claims, BITHUMB_SECRET_KEY);
  const url = `${BITHUMB_API_BASE.replace(/\/$/, "")}${path}`;
  const init = {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
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
