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
} from "./user-credentials-store.js";
import { normalizeLiveTradeMarket } from "./live-trade-market.js";

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
export function getRoundTripFeeRateForUserMarketSync(userId, market) {
  const m = normalizeLiveTradeMarket(market, "");
  if (m === "crypto") return getBithumbRoundTripFeeRateSync(userId);
  return tossDefaultRoundTrip();
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
  const row = readCredentialRowSync(uid, "bithumb");
  if (!row?.apiKeyEncrypted || !row?.secretEncrypted) return;
  const at = Number(row.bithumbFeesAtMs ?? 0);
  if (at > 0 && Date.now() - at < FEE_TTL_MS) return;
  try {
    await refreshBithumbFeesForUserAsync(uid);
  } catch (e) {
    console.warn(
      "[exchange-trading-fees] bithumb fee refresh failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * @param {string} userId
 */
export function getUserTradingFeeRatesForApiSync(userId) {
  const uid = String(userId ?? "").trim();
  const row = uid ? readCredentialRowSync(uid, "bithumb") : null;
  const bithumbRt = getBithumbRoundTripFeeRateSync(uid);
  const bithumbFromApi =
    row?.bithumbBidFee != null &&
    row?.bithumbAskFee != null &&
    row?.bithumbFeesAtMs != null;
  const tossRt = tossDefaultRoundTrip();
  return {
    defaultRoundTripFeeRate: DEFAULT_ROUND_TRIP_FEE_RATE,
    bithumb: uid
      ? {
          roundTripFeeRate: normalizeRoundTripFeeRate(bithumbRt),
          bidFee: bithumbFromApi ? row.bithumbBidFee : null,
          askFee: bithumbFromApi ? row.bithumbAskFee : null,
          source: bithumbFromApi ? "api" : "default",
          labelKo: feeLabelKo(
            row?.bithumbBidFee,
            row?.bithumbAskFee,
            bithumbRt,
            bithumbFromApi ? "api" : "default",
          ),
          market: row?.bithumbFeeMarket ?? BITHUMB_FEE_MARKET,
          updatedAtMs: row?.bithumbFeesAtMs ?? null,
        }
      : null,
    toss: {
      roundTripFeeRate: normalizeRoundTripFeeRate(tossRt),
      bidFee: null,
      askFee: null,
      source: "default",
      labelKo: feeLabelKo(null, null, tossRt, "default"),
      market: null,
      updatedAtMs: null,
    },
  };
}
