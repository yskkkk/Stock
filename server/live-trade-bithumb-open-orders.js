/**
 * 빗썸 미체결·예약 주문 + 현재가
 */
import { fetchBithumbAllKrwTickers } from "./bithumb-krw.js";
import {
  cancelBithumbOrderWithCredentials,
  getBithumbTradingStatusFromCredentials,
  listBithumbOpenOrdersWithCredentials,
} from "./bithumb-trading-adapter.js";
import { bithumbBaseToUsdtSymbol } from "./live-trade-bithumb-holdings.js";
import { cryptoYahooUsdtDisplayName } from "./crypto-display-names.js";
import { isCredentialsCryptoReady } from "./credentials-crypto.js";
import {
  getCredentialMetaSync,
  getDecryptedCredentialsSync,
} from "./user-credentials-store.js";

/**
 * @param {string} market e.g. KRW-BTC
 */
function marketToBase(market) {
  const m = String(market ?? "").trim().toUpperCase();
  if (!m.startsWith("KRW-")) return null;
  return m.slice(4) || null;
}

/**
 * @param {object} o
 */
function parseOpenOrderRow(o, tickers) {
  const orderId = String(o?.uuid ?? o?.order_id ?? "").trim();
  const market = String(o?.market ?? "").trim();
  const base = marketToBase(market);
  const symbol = base ? bithumbBaseToUsdtSymbol(base) : null;
  const name = symbol ? cryptoYahooUsdtDisplayName(symbol) : base ?? market;
  const sideRaw = String(o?.side ?? "").toLowerCase();
  const side = sideRaw === "ask" ? "sell" : sideRaw === "bid" ? "buy" : sideRaw;
  const ordType = String(o?.ord_type ?? "").trim();
  const state = String(o?.state ?? "wait").trim();
  const price = Number(o?.price);
  const volume = Number(o?.volume);
  const remaining = Number(o?.remaining_volume ?? volume);
  const executed = Number(o?.executed_volume ?? 0);
  let createdAtMs = Date.parse(String(o?.created_at ?? ""));
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) createdAtMs = Date.now();

  const t = base ? tickers[base] : null;
  const currentPrice = t
    ? Number(t.closing_price ?? t.prev_closing_price ?? 0)
    : null;
  const prev = t ? Number(t.prev_closing_price ?? 0) : null;
  let changePercent = null;
  if (
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    prev != null &&
    Number.isFinite(prev) &&
    prev > 0
  ) {
    changePercent = ((currentPrice - prev) / prev) * 100;
  }

  return {
    orderId,
    market,
    symbol: symbol ?? (base ? `${base}-USDT` : market),
    name,
    side,
    ordType,
    state,
    price: Number.isFinite(price) && price > 0 ? price : null,
    volume: Number.isFinite(volume) && volume > 0 ? volume : null,
    remainingVolume:
      Number.isFinite(remaining) && remaining >= 0 ? remaining : null,
    executedVolume: Number.isFinite(executed) && executed >= 0 ? executed : null,
    createdAtMs,
    currentPrice:
      currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0
        ? currentPrice
        : null,
    changePercent,
    currency: "KRW",
  };
}

/**
 * @param {string} userId
 */
export async function buildBithumbOpenOrdersForUser(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");

  const meta = getCredentialMetaSync(uid, "bithumb");

  if (!isCredentialsCryptoReady()) {
    return {
      ok: true,
      ready: false,
      configured: meta.configured,
      liveOrdersEnabled: meta.liveOrdersEnabled,
      messageKo: meta.ready
        ? "API 키는 저장되어 있으나 서버 CREDENTIALS_MASTER_KEY가 없어 미체결을 조회할 수 없습니다."
        : "빗썸 API Key·Secret Key를 «빗썸 API 연동»에서 저장하세요.",
      orders: [],
      updatedAtMs: Date.now(),
    };
  }

  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) {
    let messageKo = status.messageKo;
    if (meta.ready && !credentials) {
      messageKo =
        "저장된 API 키를 읽지 못했습니다. «빗썸 API 연동»에서 Key·Secret을 다시 저장해 주세요.";
    } else if (meta.configured && !meta.hasSecret) {
      messageKo = "Secret Key가 없습니다. «빗썸 API 연동»에서 Secret Key를 함께 저장하세요.";
    }
    return {
      ok: true,
      ready: false,
      configured: meta.configured,
      liveOrdersEnabled: meta.liveOrdersEnabled,
      messageKo,
      orders: [],
      updatedAtMs: Date.now(),
    };
  }

  try {
    const raw = await listBithumbOpenOrdersWithCredentials(
      /** @type {import("./bithumb-trading-adapter.js").BithumbCredentials} */ (
        credentials
      ),
    );
    const tickers = await fetchBithumbAllKrwTickers();
    const orders = raw
      .map((o) => parseOpenOrderRow(o, tickers))
      .filter((r) => r.orderId);

    return {
      ok: true,
      ready: true,
      configured: true,
      liveOrdersEnabled: Boolean(credentials?.liveOrdersEnabled),
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
export async function cancelBithumbOpenOrderForUser(userId, orderId) {
  const uid = String(userId ?? "").trim();
  if (!uid) throw new Error("로그인이 필요합니다.");
  const credentials = getDecryptedCredentialsSync(uid, "bithumb");
  const status = getBithumbTradingStatusFromCredentials(credentials);
  if (!status.ready) throw new Error(status.messageKo);
  await cancelBithumbOrderWithCredentials(orderId, credentials);
  return buildBithumbOpenOrdersForUser(uid);
}
