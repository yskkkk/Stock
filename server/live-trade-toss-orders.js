/**
 * 토스 미체결 주문 조회·취소·수동 주문
 */
import { resolveDisplayName } from "./names-ko.js";
import { parseTossDecimal } from "./toss-openapi.js";
import { isCredentialsCryptoReady } from "./credentials-crypto.js";
import {
  getCredentialMetaSync,
  getDecryptedCredentialsSync,
} from "./user-credentials-store.js";
import {
  cancelTossOrderWithCredentials,
  getTossTradingStatusForUser,
  isTossLiveOrdersEnabledForUser,
  listTossOpenOrdersWithCredentials,
  placeManualTossOrderForUser,
} from "./toss-trading-adapter.js";

/**
 * @param {unknown} v
 */
function parseTossOrderSide(v) {
  const raw = String(v ?? "").trim().toUpperCase();
  if (raw === "SELL") return "sell";
  if (raw === "BUY") return "buy";
  return raw.toLowerCase();
}

/**
 * @param {unknown} v
 */
function parseTossOrderType(v) {
  const raw = String(v ?? "").trim().toUpperCase();
  if (raw === "LIMIT") return "limit";
  if (raw === "MARKET") return "market";
  return String(v ?? "").trim().toLowerCase() || "market";
}

/**
 * @param {unknown} o
 */
function parseTossOpenOrderRow(o) {
  const orderId = String(o?.orderId ?? o?.id ?? "").trim();
  const rawSymbol = String(o?.symbol ?? "").trim();
  const marketCountry = String(o?.marketCountry ?? o?.market ?? "").trim().toUpperCase();
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
  const name = resolveDisplayName(symbol, String(o?.name ?? rawSymbol).trim() || rawSymbol);
  const side = parseTossOrderSide(o?.side);
  const ordType = parseTossOrderType(o?.orderType ?? o?.type);
  const state = String(o?.status ?? o?.state ?? "pending").trim();
  const priceObj = o?.price && typeof o.price === "object" ? o.price : null;
  const amountObj =
    o?.orderAmount && typeof o.orderAmount === "object"
      ? o.orderAmount
      : o?.amount && typeof o.amount === "object"
        ? o.amount
        : null;
  const execution = o?.execution && typeof o.execution === "object" ? o.execution : null;
  const price = parseTossDecimal(priceObj?.value ?? o?.price);
  const amount = parseTossDecimal(
    amountObj?.value ?? o?.orderAmount ?? o?.amount,
  );
  const quantity = parseTossDecimal(o?.quantity ?? o?.orderQuantity);
  const executed = parseTossDecimal(
    execution?.filledQuantity ?? o?.executedQuantity ?? o?.filledQuantity,
  );
  let remaining = parseTossDecimal(
    o?.remainingQuantity ?? o?.unfilledQuantity ?? o?.remaining,
  );
  if (!(remaining >= 0 && Number.isFinite(remaining)) && quantity > 0 && executed >= 0) {
    remaining = Math.max(0, quantity - executed);
  }
  const currencyRaw = String(
    priceObj?.currency ?? amountObj?.currency ?? (market === "us" ? "USD" : "KRW"),
  ).toUpperCase();
  const currency = currencyRaw === "USD" ? "USD" : "KRW";

  let createdAtMs = Date.parse(String(o?.orderedAt ?? o?.createdAt ?? ""));
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) createdAtMs = Date.now();

  return {
    orderId,
    symbol,
    rawSymbol,
    name,
    market,
    side,
    ordType,
    state,
    price: price > 0 ? price : null,
    amount: amount > 0 ? amount : null,
    volume: quantity > 0 ? quantity : null,
    remainingVolume: remaining >= 0 && Number.isFinite(remaining) ? remaining : null,
    executedVolume: executed >= 0 && Number.isFinite(executed) ? executed : null,
    createdAtMs,
    currency,
  };
}

/**
 * @param {string} userId
 */
export async function buildTossOpenOrdersForUser(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const meta = getCredentialMetaSync(uid, "toss");
  const serverLive = process.env.TOSS_LIVE_ORDERS_ENABLED === "1";

  if (!isCredentialsCryptoReady()) {
    return {
      ok: true,
      ready: false,
      configured: meta.configured,
      liveOrdersEnabled: meta.liveOrdersEnabled,
      serverLiveOrdersEnabled: serverLive,
      messageKo: meta.ready
        ? "API 키는 저장되어 있으나 서버 CREDENTIALS_MASTER_KEY가 없어 미체결을 조회할 수 없습니다."
        : "토스 API Key·Secret Key를 «토스 API 연동»에서 저장하세요.",
      orders: [],
      updatedAtMs: Date.now(),
    };
  }

  const credentials = getDecryptedCredentialsSync(uid, "toss");
  const status = getTossTradingStatusForUser(uid);
  if (!status.ready) {
    let messageKo = status.messageKo;
    if (meta.ready && !credentials) {
      messageKo =
        "저장된 API 키를 읽지 못했습니다. «토스 API 연동»에서 Key·Secret을 다시 저장해 주세요.";
    } else if (meta.configured && !meta.hasSecret) {
      messageKo = "Secret Key가 없습니다. «토스 API 연동»에서 Secret Key를 함께 저장하세요.";
    }
    return {
      ok: true,
      ready: false,
      configured: meta.configured,
      liveOrdersEnabled: meta.liveOrdersEnabled,
      serverLiveOrdersEnabled: serverLive,
      messageKo,
      orders: [],
      updatedAtMs: Date.now(),
    };
  }

  try {
    const raw = await listTossOpenOrdersWithCredentials(
      /** @type {import("./toss-trading-adapter.js").TossTradingCredentials} */ (
        credentials
      ),
    );
    const orders = raw.map((o) => parseTossOpenOrderRow(o)).filter((r) => r.orderId);

    return {
      ok: true,
      ready: true,
      configured: true,
      liveOrdersEnabled: Boolean(credentials?.liveOrdersEnabled),
      serverLiveOrdersEnabled: serverLive,
      messageKo: status.messageKo,
      orders,
      updatedAtMs: Date.now(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: true,
      ready: true,
      configured: true,
      liveOrdersEnabled: Boolean(credentials?.liveOrdersEnabled),
      serverLiveOrdersEnabled: serverLive,
      messageKo: status.messageKo,
      orders: [],
      fetchError: msg,
      updatedAtMs: Date.now(),
    };
  }
}

/**
 * @param {string} userId
 * @param {string} orderId
 */
export async function cancelTossOpenOrderForUser(userId, orderId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");
  if (!isTossLiveOrdersEnabledForUser(uid)) {
    throw new Error("실주문이 꺼져 있습니다. «실주문 허용»과 서버 TOSS_LIVE_ORDERS_ENABLED를 확인하세요.");
  }
  const credentials = getDecryptedCredentialsSync(uid, "toss");
  const status = getTossTradingStatusForUser(uid);
  if (!status.ready) throw new Error(status.messageKo);
  await cancelTossOrderWithCredentials(orderId, credentials);
  return buildTossOpenOrdersForUser(uid);
}

/**
 * @param {string} userId
 * @param {object} body
 */
export async function placeTossOrderForUser(userId, body) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");
  const result = await placeManualTossOrderForUser(uid, {
    symbol: String(body?.symbol ?? ""),
    market: body?.market,
    side: body?.side,
    orderType: body?.orderType,
    amount: body?.amount != null ? Number(body.amount) : undefined,
    quantity: body?.quantity != null ? Number(body.quantity) : undefined,
    price: body?.price != null ? Number(body.price) : undefined,
  });
  if (!result.ok) {
    throw new Error(result.error ?? "주문에 실패했습니다.");
  }
  // 주문 API 응답을 먼저 반환 — 미체결·원장 갱신은 큐 경합 없이 백그라운드
  void buildTossOpenOrdersForUser(uid).catch(() => null);
  return {
    ok: true,
    ...result,
  };
}
