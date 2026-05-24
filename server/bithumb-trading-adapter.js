/**
 * 빗썸 Open API v2 — JWT 인증·시장가 주문 (KRW 마켓).
 * BYOK: { apiKey, secretKey, liveOrdersEnabled } 주입. 서버 .env 단일키는 테스트 스크립트 전용.
 * @see https://apidocs.bithumb.com
 */
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  resolveOrderAmountForMarket,
  quantityFromOrderAmount,
  CRYPTO_MIN_ORDER_KRW,
} from "./live-trade-market.js";
import { usdtSymbolToBithumbBase } from "./bithumb-krw.js";
import { pickMeetsProgramThreshold } from "./toss-trading-adapter.js";

/** @typedef {"unconfigured" | "configured" | "ready"} BithumbApiPhase */

/**
 * @typedef {{
 *   apiKey: string;
 *   secretKey: string;
 *   liveOrdersEnabled?: boolean;
 *   apiBaseUrl?: string;
 * }} BithumbCredentials
 */

function bithumbApiKeyEnv() {
  return String(process.env.BITHUMB_API_KEY ?? "").trim();
}

function bithumbSecretKeyEnv() {
  return String(process.env.BITHUMB_SECRET_KEY ?? "").trim();
}

function bithumbApiBase() {
  return String(
    process.env.BITHUMB_API_BASE_URL ?? "https://api.bithumb.com",
  ).trim();
}

/** @returns {BithumbCredentials | null} */
function envCredentials() {
  const apiKey = bithumbApiKeyEnv();
  const secretKey = bithumbSecretKeyEnv();
  if (!apiKey && !secretKey) return null;
  return {
    apiKey,
    secretKey,
    liveOrdersEnabled: process.env.BITHUMB_LIVE_ORDERS_ENABLED === "1",
    apiBaseUrl: bithumbApiBase(),
  };
}

/**
 * @param {BithumbCredentials | null | undefined} credentials
 */
export function getBithumbTradingStatusFromCredentials(credentials) {
  const apiKey = String(credentials?.apiKey ?? "").trim();
  const secretKey = String(credentials?.secretKey ?? "").trim();
  let phase = /** @type {BithumbApiPhase} */ ("unconfigured");
  if (apiKey && secretKey) phase = "ready";
  else if (apiKey) phase = "configured";
  const configured = phase !== "unconfigured";
  const ready = phase === "ready";
  let messageKo =
    "빗썸 API가 없습니다. 실거래 탭 «내 API 연동»에서 API Key·Secret Key를 저장하세요.";
  if (phase === "configured") {
    messageKo = "API Key만 있습니다. Secret Key를 함께 저장하세요.";
  } else if (ready) {
    messageKo = "빗썸 연동됨 · 실주문은 «빗썸 실매매 시작» 프로그램에서 실행";
  }
  return {
    phase,
    configured,
    ready,
    messageKo,
    liveOrdersEnabled: Boolean(credentials?.liveOrdersEnabled),
    docsHint: "https://apidocs.bithumb.com",
  };
}

export function getBithumbApiPhase() {
  return getBithumbTradingStatusFromCredentials(envCredentials()).phase;
}

export function isBithumbTradingReady() {
  return getBithumbApiPhase() === "ready";
}

/** @deprecated 테스트·레거시 — UI/러너는 BYOK status 사용 */
export function getBithumbTradingStatus() {
  return getBithumbTradingStatusFromCredentials(envCredentials());
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

function queryHashSha512(params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("&");
  return crypto.createHash("sha512").update(qs, "utf8").digest("hex");
}

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
 * @param {string} path
 * @param {Record<string, string | number> | null} bodyParams
 * @param {BithumbCredentials} credentials
 */
async function bithumbPrivateRequestWithCredentials(
  method,
  path,
  bodyParams,
  credentials,
) {
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) {
    throw new Error(status.messageKo);
  }
  const claims = {
    access_key: String(credentials.apiKey).trim(),
    nonce: randomUUID(),
    timestamp: Date.now(),
  };
  if (bodyParams && Object.keys(bodyParams).length > 0) {
    claims.query_hash = queryHashSha512(bodyParams);
    claims.query_hash_alg = "SHA512";
  }
  const token = signJwtHs256(claims, String(credentials.secretKey).trim());
  const base = String(credentials.apiBaseUrl ?? bithumbApiBase()).replace(
    /\/$/,
    "",
  );
  let url = `${base}${path}`;
  if (
    (method === "GET" || method === "DELETE") &&
    bodyParams &&
    Object.keys(bodyParams).length > 0 &&
    !path.includes("?")
  ) {
    const qs = Object.entries(bodyParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    url = `${url}?${qs}`;
  }
  const init = {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (bodyParams && method !== "GET" && method !== "DELETE") {
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

/** 레거시 env — scripts/bithumb-test-order.mjs */
async function bithumbPrivateRequest(method, path, bodyParams = null) {
  const creds = envCredentials();
  if (!creds?.apiKey || !creds?.secretKey) {
    throw new Error(getBithumbTradingStatus().messageKo);
  }
  return bithumbPrivateRequestWithCredentials(
    method,
    path,
    bodyParams,
    creds,
  );
}

/**
 * @param {BithumbCredentials} credentials
 */
/**
 * @param {BithumbCredentials} credentials
 * @param {string} [market] e.g. KRW-BTC
 */
export async function fetchBithumbOrderChanceWithCredentials(
  credentials,
  market = "KRW-BTC",
) {
  const m = String(market ?? "KRW-BTC").trim();
  const q = { market: m };
  return bithumbPrivateRequestWithCredentials(
    "GET",
    "/v1/orders/chance",
    q,
    credentials,
  );
}

export async function fetchBithumbAccountsWithCredentials(credentials) {
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) return [];
  const body = await bithumbPrivateRequestWithCredentials(
    "GET",
    "/v1/accounts",
    null,
    credentials,
  );
  return Array.isArray(body) ? body : [];
}

export async function fetchBithumbAccounts() {
  const creds = envCredentials();
  if (!creds) return [];
  return fetchBithumbAccountsWithCredentials(creds);
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {object} pick
 * @param {{ credentials?: BithumbCredentials | null }} [options]
 */
export async function executeBithumbLiveBuyOrder(program, pick, options = {}) {
  const credentials = options.credentials ?? null;
  const status = getBithumbTradingStatusFromCredentials(credentials);
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
  if (krw < CRYPTO_MIN_ORDER_KRW) {
    return {
      ok: false,
      error: `코인 1회 매수 금액은 ${CRYPTO_MIN_ORDER_KRW.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
    };
  }

  try {
    const body = await bithumbPrivateRequestWithCredentials(
      "POST",
      "/v1/orders",
      {
        market,
        side: "bid",
        ord_type: "price",
        price: String(krw),
      },
      /** @type {BithumbCredentials} */ (credentials),
    );
    const orderId = String(body.uuid ?? body.order_id ?? "");
    if (!orderId) return { ok: false, error: "주문 ID를 받지 못했습니다." };
    const fill = await pollBithumbOrderFill(
      orderId,
      /** @type {BithumbCredentials} */ (credentials),
    );
    return { ok: true, orderId, fillPrice: fill?.price ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {{ market: string; volume: number }} input
 * @param {{ credentials?: BithumbCredentials | null }} [options]
 */
export async function executeBithumbLiveSellOrder(input, options = {}) {
  const credentials = options.credentials ?? envCredentials();
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  const market = String(input.market ?? "").trim();
  const volume = Number(input.volume);
  if (!market || !Number.isFinite(volume) || volume <= 0) {
    return { ok: false, error: "매도 수량이 올바르지 않습니다." };
  }

  try {
    const vol =
      Math.round(volume * 1e8) / 1e8 > 0
        ? String(Math.round(volume * 1e8) / 1e8)
        : String(volume);
    const body = await bithumbPrivateRequestWithCredentials(
      "POST",
      "/v1/orders",
      {
        market,
        side: "ask",
        ord_type: "market",
        volume: vol,
      },
      /** @type {BithumbCredentials} */ (credentials),
    );
    const orderId = String(body.uuid ?? "").trim();
    if (!orderId) return { ok: false, error: "매도 주문 ID를 받지 못했습니다." };
    const fill = await pollBithumbOrderFill(
      orderId,
      /** @type {BithumbCredentials} */ (credentials),
    );
    return { ok: true, orderId, fillPrice: fill?.price ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * @param {string} orderId
 * @param {BithumbCredentials} credentials
 */
export async function fetchBithumbOrderWithCredentials(orderId, credentials) {
  const qs = { uuid: orderId };
  return bithumbPrivateRequestWithCredentials("GET", "/v1/orders", qs, credentials);
}

/**
 * @param {BithumbCredentials} credentials
 * @param {{ market?: string; state?: "wait"|"watch"|"done"|"cancel"; limit?: number; orderBy?: "asc"|"desc" }} [opts]
 */
export async function listBithumbOrdersWithCredentials(credentials, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 50));
  const orderBy = opts.orderBy === "asc" ? "asc" : "desc";
  const state = opts.state ?? "wait";
  const params = {
    state,
    limit,
    order_by: orderBy,
  };
  if (opts.market) params.market = String(opts.market).trim();
  const body = await bithumbPrivateRequestWithCredentials(
    "GET",
    "/v1/orders",
    params,
    credentials,
  );
  return Array.isArray(body) ? body : [];
}

/** @param {BithumbCredentials} credentials */
export async function listBithumbOpenOrdersWithCredentials(credentials) {
  const [wait, watch] = await Promise.all([
    listBithumbOrdersWithCredentials(credentials, { state: "wait", limit: 100 }),
    listBithumbOrdersWithCredentials(credentials, { state: "watch", limit: 100 }),
  ]);
  const seen = new Set();
  /** @type {object[]} */
  const out = [];
  for (const o of [...wait, ...watch]) {
    const id = String(o?.uuid ?? o?.order_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(o);
  }
  out.sort((a, b) => {
    const ta = Date.parse(String(a?.created_at ?? ""));
    const tb = Date.parse(String(b?.created_at ?? ""));
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  return out;
}

/**
 * @param {string} orderId uuid
 * @param {BithumbCredentials} credentials
 */
export async function cancelBithumbOrderWithCredentials(orderId, credentials) {
  const uuid = String(orderId ?? "").trim();
  if (!uuid) throw new Error("주문 ID가 없습니다.");
  return bithumbPrivateRequestWithCredentials(
    "DELETE",
    "/v1/order",
    { uuid },
    credentials,
  );
}

export async function listBithumbDoneOrdersWithCredentials(
  credentials,
  market,
  opts = {},
) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 30));
  const orderBy = opts.orderBy === "asc" ? "asc" : "desc";
  const body = await bithumbPrivateRequestWithCredentials(
    "GET",
    "/v1/orders",
    {
      market: String(market ?? "").trim(),
      state: "done",
      limit,
      order_by: orderBy,
    },
    credentials,
  );
  return Array.isArray(body) ? body : [];
}

/**
 * 주문 후 체결가·체결량 조회 (최대 3회, 2초 간격).
 * @param {string} orderId
 * @param {BithumbCredentials} credentials
 * @returns {Promise<{ price: number; volume: number; funds: number } | null>}
 */
export async function pollBithumbOrderFill(orderId, credentials) {
  const MAX_ATTEMPTS = 3;
  const DELAY_MS = 2_000;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    try {
      const body = await fetchBithumbOrderWithCredentials(orderId, credentials);
      const execVolume = Number(body?.executed_volume ?? 0);
      const execFunds = Number(body?.executed_funds ?? 0);
      if (execVolume > 0 && execFunds > 0) {
        return { price: execFunds / execVolume, volume: execVolume, funds: execFunds };
      }
    } catch (e) {
      console.warn(
        "[bithumb-trading] 체결가 조회 실패:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return null;
}

export function estimateBithumbBuyQuantity(yahooSymbol, price, amountKrw) {
  return quantityFromOrderAmount(amountKrw, price, "crypto");
}

export async function executeBithumbMarketBuyKrw(market, krw) {
  const status = getBithumbTradingStatus();
  if (!status.ready) {
    return { ok: false, error: status.messageKo };
  }
  const mk = String(market ?? "").trim();
  const amount = Math.floor(Number(krw));
  if (!mk || !Number.isFinite(amount) || amount < CRYPTO_MIN_ORDER_KRW) {
    return {
      ok: false,
      error: `코인 1회 매수 금액은 ${CRYPTO_MIN_ORDER_KRW.toLocaleString("ko-KR")}원 이상이 필요합니다.`,
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
