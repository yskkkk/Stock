/**
 * 토스증권 Open API 어댑터 — 회원별 API 키 또는 서버 env.
 * 공식 스펙 반영 전까지는 연결 검증·주문 스텁.
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
  if (!tossAccountId()) return "configured";
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
      "API 키는 등록됐습니다. 계좌 정보를 추가하면 실매매를 켤 수 있습니다.";
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
  if (!creds.accountId) {
    return {
      phase: "configured",
      configured: true,
      ready: false,
      messageKo:
        "토스 API 키는 등록됐습니다. «내 API 연동»에서 계좌 ID를 추가하세요.",
      hasSecret: Boolean(creds.secret),
      hasAccount: false,
      baseUrl: tossApiBase() || null,
      docsHint: "https://docs.tossinvest.com",
      source: creds.source,
    };
  }
  return {
    phase: "ready",
    configured: true,
    ready: true,
    messageKo: "회원 토스 API 연동 준비됨.",
    hasSecret: Boolean(creds.secret),
    hasAccount: true,
    baseUrl: tossApiBase() || null,
    docsHint: "https://docs.tossinvest.com",
    source: creds.source,
  };
}

function tossReadyForUser(userId) {
  const creds = resolveTossCredentials(userId);
  return Boolean(creds.apiKey && creds.accountId);
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

  if (process.env.TOSS_LIVE_ORDERS_ENABLED !== "1") {
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
    const base = tossApiBase() || "https://api.tossinvest.com";
    const res = await fetch(`${base}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        ...(creds.secret ? { "X-Toss-Secret": creds.secret } : {}),
      },
      body: JSON.stringify({
        accountId: creds.accountId,
        symbol,
        market,
        side: "buy",
        amount,
        clientOrderId: `${program.id}-${symbol}-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      const err =
        typeof body.error === "string"
          ? body.error
          : typeof body.message === "string"
            ? body.message
            : `토스 API 오류 HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    return {
      ok: true,
      orderId: String(body.orderId ?? body.id ?? ""),
      fillPrice:
        typeof body.fillPrice === "number" && Number.isFinite(body.fillPrice)
          ? body.fillPrice
          : undefined,
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

  if (process.env.TOSS_LIVE_ORDERS_ENABLED !== "1") {
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
    const base = tossApiBase() || "https://api.tossinvest.com";
    const res = await fetch(`${base}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        ...(creds.secret ? { "X-Toss-Secret": creds.secret } : {}),
      },
      body: JSON.stringify({
        accountId: creds.accountId,
        symbol,
        market,
        side: "sell",
        quantity,
        ...(price != null ? { price } : {}),
        clientOrderId: `${program.id}-${symbol}-sell-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      const err =
        typeof body.error === "string"
          ? body.error
          : typeof body.message === "string"
            ? body.message
            : `토스 API 오류 HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    return {
      ok: true,
      orderId: String(body.orderId ?? body.id ?? ""),
      fillPrice:
        typeof body.fillPrice === "number" && Number.isFinite(body.fillPrice)
          ? body.fillPrice
          : price,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
