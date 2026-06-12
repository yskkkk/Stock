/**
 * 사용자별 거래소 API 수수료 — 빗썸 orders/chance, 미연동 시 기본값
 */
import {
  DEFAULT_ROUND_TRIP_FEE_RATE,
  normalizeRoundTripFeeRate,
  roundTripFeeRateFromOneWay,
} from "./net-return.js";
import { fetchBithumbOrderChanceWithCredentials } from "./bithumb-trading-adapter.js";
import {
  getDecryptedCredentialsSync,
  readCredentialRowSync,
  writeBithumbFeesOnRowSync,
  writeTossFeesOnRowSync,
} from "./user-credentials-store.js";
import { normalizeLiveTradeMarket } from "./live-trade-market.js";
import {
  fetchTossCommissionsWithCredentials,
  parseTossDecimal,
} from "./toss-openapi.js";

const FEE_TTL_MS = 60 * 60 * 1000;
const BITHUMB_FEE_MARKET =
  String(process.env.BITHUMB_FEE_MARKET ?? "KRW-BTC").trim() || "KRW-BTC";

function tossDefaultRoundTrip() {
  const raw = String(process.env.TOSS_ROUND_TRIP_FEE_RATE ?? "").trim();
  if (!raw) return DEFAULT_ROUND_TRIP_FEE_RATE;
  const env = Number(raw);
  if (Number.isFinite(env) && env >= 0 && env < 0.2) return env;
  return DEFAULT_ROUND_TRIP_FEE_RATE;
}

/**
 * @param {unknown} body
 */
export function parseBithumbChanceFees(body) {
  const bid = Number(/** @type {{ bid_fee?: unknown }} */ (body)?.bid_fee);
  const ask = Number(/** @type {{ ask_fee?: unknown }} */ (body)?.ask_fee);
  const roundTripFeeRate = roundTripFeeRateFromOneWay(bid, ask);
  if (roundTripFeeRate == null) return null;
  return {
    bidFee: bid,
    askFee: ask,
    roundTripFeeRate,
    market: BITHUMB_FEE_MARKET,
  };
}

function feeLabelKo(bidFee, askFee, roundTrip, source) {
  const pct = (n) => `${(n * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
  if (source === "api" && Number.isFinite(bidFee) && Number.isFinite(askFee)) {
    return `매수 ${pct(bidFee)} · 매도 ${pct(askFee)} (왕복 ${pct(roundTrip)})`;
  }
  return `기본 왕복 ${pct(roundTrip)} (API 미조회)`;
}

/**
 * @param {string} userId
 */
export function getBithumbRoundTripFeeRateSync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return DEFAULT_ROUND_TRIP_FEE_RATE;
  const row = readCredentialRowSync(uid, "bithumb");
  if (row?.bithumbBidFee != null && row?.bithumbAskFee != null) {
    const rt = roundTripFeeRateFromOneWay(row.bithumbBidFee, row.bithumbAskFee);
    if (rt != null) return rt;
  }
  return DEFAULT_ROUND_TRIP_FEE_RATE;
}

/**
 * @param {string} userId
 * @param {"kr"|"us"|"crypto"} market
 */
function tossRoundTripFromRowFees(row, market = "kr") {
  if (!row) return null;
  const m = String(market ?? "kr").toLowerCase();
  if (m === "us" && row.tossUsBidFee != null && row.tossUsAskFee != null) {
    return roundTripFeeRateFromOneWay(row.tossUsBidFee, row.tossUsAskFee);
  }
  if (row.tossBidFee != null && row.tossAskFee != null) {
    return roundTripFeeRateFromOneWay(row.tossBidFee, row.tossAskFee);
  }
  return null;
}

export function getTossRoundTripFeeRateSync(userId, market = "kr") {
  const uid = String(userId ?? "").trim();
  if (!uid) return tossDefaultRoundTrip();
  const row = readCredentialRowSync(uid, "toss");
  const rt = tossRoundTripFromRowFees(row, market);
  if (rt != null) return rt;
  return tossDefaultRoundTrip();
}

export function getTossFeeRatesByMarketSync(userId) {
  const uid = String(userId ?? "").trim();
  const fees = uid ? getUserTradingFeeRatesForApiSync(uid).toss : null;
  const kr = getTossRoundTripFeeRateSync(uid, "kr");
  const us = getTossRoundTripFeeRateSync(uid, "us");
  return {
    kr,
    us,
    source: fees?.source === "api" ? "api" : "default",
  };
}

export function getRoundTripFeeRateForUserMarketSync(userId, market) {
  const m = normalizeLiveTradeMarket(market, "");
  if (m === "crypto") return getBithumbRoundTripFeeRateSync(userId);
  return getTossRoundTripFeeRateSync(userId);
}

/**
 * @param {string} userId
 * @param {"kr"|"us"|"crypto"} market
 */
export function getOneWayFeeRateForUserMarketSync(userId, market) {
  return getRoundTripFeeRateForUserMarketSync(userId, market) / 2;
}

/**
 * @param {string} userId
 * @returns {Promise<{ bidFee: number; askFee: number; roundTripFeeRate: number } | null>}
 */
/**
 * @param {unknown} body
 */
export function parseTossCommissionFees(body) {
  const result =
    body && typeof body === "object" && "result" in body
      ? /** @type {Record<string, unknown>} */ (body).result
      : body;
  const row =
    result && typeof result === "object"
      ? /** @type {Record<string, unknown>} */ (result)
      : {};
  const buyObj =
    row.buy && typeof row.buy === "object"
      ? /** @type {Record<string, unknown>} */ (row.buy)
      : null;
  const sellObj =
    row.sell && typeof row.sell === "object"
      ? /** @type {Record<string, unknown>} */ (row.sell)
      : null;
  const bid = parseTossDecimal(
    row.buyCommissionRate ??
      row.buyRate ??
      buyObj?.commissionRate ??
      buyObj?.rate ??
      row.bidFee,
  );
  const ask = parseTossDecimal(
    row.sellCommissionRate ??
      row.sellRate ??
      sellObj?.commissionRate ??
      sellObj?.rate ??
      row.askFee,
  );
  const roundTripFeeRate = roundTripFeeRateFromOneWay(bid, ask);
  if (roundTripFeeRate == null) return null;
  if (bid <= 0 && ask <= 0) return null;
  return {
    bidFee: bid,
    askFee: ask,
    roundTripFeeRate,
    market: String(row.marketCountry ?? "KR").trim() || "KR",
  };
}

/**
 * @param {string} userId
 * @returns {Promise<{ bidFee: number; askFee: number; roundTripFeeRate: number } | null>}
 */
export async function refreshTossFeesForUserAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const creds = getDecryptedCredentialsSync(uid, "toss");
  if (!creds?.apiKey || !creds?.secretKey) return null;
  let kr = null;
  let us = null;
  try {
    const { result } = await fetchTossCommissionsWithCredentials(creds, "KR");
    kr = parseTossCommissionFees(result);
    if (kr) writeTossFeesOnRowSync(uid, kr);
  } catch {
    /* KR 수수료 실패 시 US만이라도 시도 */
  }
  try {
    const { result } = await fetchTossCommissionsWithCredentials(creds, "US");
    us = parseTossCommissionFees(result);
    if (us) writeTossFeesOnRowSync(uid, us);
  } catch {
    /* US 수수료 없으면 KR만 사용 */
  }
  return kr ?? us;
}

export async function refreshBithumbFeesForUserAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const creds = getDecryptedCredentialsSync(uid, "bithumb");
  if (!creds?.apiKey || !creds?.secretKey) return null;
  const chance = await fetchBithumbOrderChanceWithCredentials(
    creds,
    BITHUMB_FEE_MARKET,
  );
  const parsed = parseBithumbChanceFees(chance);
  if (!parsed) return null;
  writeBithumbFeesOnRowSync(uid, parsed);
  return parsed;
}

/**
 * @param {string} userId
 */
export async function ensureUserTradingFeesFreshAsync(userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return;
  const bithumbRow = readCredentialRowSync(uid, "bithumb");
  if (bithumbRow?.apiKeyEncrypted && bithumbRow?.secretEncrypted) {
    const at = Number(bithumbRow.bithumbFeesAtMs ?? 0);
    if (!(at > 0 && Date.now() - at < FEE_TTL_MS)) {
      try {
        await refreshBithumbFeesForUserAsync(uid);
      } catch (e) {
        console.warn(
          "[exchange-trading-fees] bithumb fee refresh failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
  const tossRow = readCredentialRowSync(uid, "toss");
  if (tossRow?.apiKeyEncrypted && tossRow?.secretEncrypted) {
    const at = Number(tossRow.tossFeesAtMs ?? 0);
    if (!(at > 0 && Date.now() - at < FEE_TTL_MS)) {
      try {
        await refreshTossFeesForUserAsync(uid);
      } catch (e) {
        console.warn(
          "[exchange-trading-fees] toss fee refresh failed:",
          e instanceof Error ? e.message : e,
        );
      }
    }
  }
}

/**
 * @param {string} userId
 */
export function getUserTradingFeeRatesForApiSync(userId) {
  const uid = String(userId ?? "").trim();
  const bithumbRow = uid ? readCredentialRowSync(uid, "bithumb") : null;
  const tossRow = uid ? readCredentialRowSync(uid, "toss") : null;
  const bithumbRt = getBithumbRoundTripFeeRateSync(uid);
  const bithumbFromApi =
    bithumbRow?.bithumbBidFee != null &&
    bithumbRow?.bithumbAskFee != null &&
    bithumbRow?.bithumbFeesAtMs != null;
  const tossKrRt = getTossRoundTripFeeRateSync(uid, "kr");
  const tossUsRt = getTossRoundTripFeeRateSync(uid, "us");
  const tossFromApi =
    (tossRow?.tossBidFee != null &&
      tossRow?.tossAskFee != null &&
      tossRow?.tossFeesAtMs != null) ||
    (tossRow?.tossUsBidFee != null &&
      tossRow?.tossUsAskFee != null &&
      tossRow?.tossUsFeesAtMs != null);
  return {
    defaultRoundTripFeeRate: DEFAULT_ROUND_TRIP_FEE_RATE,
    bithumb: uid
      ? {
          roundTripFeeRate: normalizeRoundTripFeeRate(bithumbRt),
          bidFee: bithumbFromApi ? row.bithumbBidFee : null,
          askFee: bithumbFromApi ? row.bithumbAskFee : null,
          source: bithumbFromApi ? "api" : "default",
          labelKo: feeLabelKo(
            bithumbRow?.bithumbBidFee,
            bithumbRow?.bithumbAskFee,
            bithumbRt,
            bithumbFromApi ? "api" : "default",
          ),
          market: bithumbRow?.bithumbFeeMarket ?? BITHUMB_FEE_MARKET,
          updatedAtMs: bithumbRow?.bithumbFeesAtMs ?? null,
        }
      : null,
    toss: {
      roundTripFeeRate: normalizeRoundTripFeeRate(tossKrRt),
      krRoundTripFeeRate: normalizeRoundTripFeeRate(tossKrRt),
      usRoundTripFeeRate: normalizeRoundTripFeeRate(tossUsRt),
      bidFee: tossFromApi ? tossRow.tossBidFee : null,
      askFee: tossFromApi ? tossRow.tossAskFee : null,
      source: tossFromApi ? "api" : "default",
      labelKo: feeLabelKo(
        tossRow?.tossBidFee,
        tossRow?.tossAskFee,
        tossKrRt,
        tossFromApi ? "api" : "default",
      ),
      market: tossRow?.tossFeeMarket ?? null,
      updatedAtMs: tossRow?.tossFeesAtMs ?? null,
    },
  };
}
