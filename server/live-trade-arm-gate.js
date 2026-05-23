import {
  getBithumbTradingStatusForUserSync,
} from "./user-credentials-store.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";
import { getCredentialMetaSync } from "./user-credentials-store.js";

/** @typedef {"bithumb" | "toss"} LiveTradeArmLane */

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 */
export function getProgramArmedMarkets(program) {
  const mk = program?.markets ?? {};
  const raw = program?.armedMarkets;
  if (raw && typeof raw === "object") {
    return {
      kr: Boolean(raw.kr),
      crypto: Boolean(raw.crypto),
    };
  }
  if (program?.status === "armed") {
    return { kr: Boolean(mk.kr), crypto: Boolean(mk.crypto) };
  }
  return { kr: false, crypto: false };
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {"kr" | "crypto"} market
 */
export function isProgramArmedForMarket(program, market) {
  if (program?.status !== "armed") return false;
  const armed = getProgramArmedMarkets(program);
  if (market === "crypto") return Boolean(armed.crypto);
  if (market === "kr") return Boolean(armed.kr);
  return false;
}

/**
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 * @param {LiveTradeArmLane} lane
 * @param {string} userId
 */
export function validateLiveTradeArmLane(program, lane, userId) {
  const mk = program?.markets ?? {};
  if (lane === "bithumb") {
    if (!mk.crypto) {
      throw new Error("이 프로그램에 코인 시장이 선택되어 있지 않습니다.");
    }
    const bithumb = getBithumbTradingStatusForUserSync(userId);
    if (!bithumb.configured) {
      throw new Error(
        bithumb.messageKo ??
          "코인 실매매에는 빗썸 API 키가 필요합니다. «내 API 연동»에서 저장하세요.",
      );
    }
    return { lane, bithumb, toss: getTossTradingStatus() };
  }
  if (lane === "toss") {
    if (!mk.kr) {
      throw new Error("이 프로그램에 국내 시장이 선택되어 있지 않습니다.");
    }
    if (mk.us) {
      throw new Error("미국 주식 실매매는 아직 지원하지 않습니다.");
    }
    const userToss = getCredentialMetaSync(userId, "toss");
    const toss =
      userToss.source === "user" && userToss.ready
        ? {
            phase: "ready",
            configured: true,
            ready: true,
            messageKo: userToss.messageKo,
          }
        : getTossTradingStatus();
    if (!toss.configured) {
      throw new Error(
        toss.messageKo ??
          "국내 실매매에는 토스 API 키가 필요합니다. «내 API 연동» 또는 서버 설정을 확인하세요.",
      );
    }
    return { lane, toss, bithumb: getBithumbTradingStatusForUserSync(userId) };
  }
  throw new Error("지원하지 않는 실매매 채널입니다.");
}

/** @deprecated */
export function validateLiveTradeArmGate(program) {
  const mk = program?.markets ?? {};
  if (!mk.kr && !mk.us && !mk.crypto) {
    throw new Error("국내·미국·코인 중 하나 이상을 선택하세요.");
  }
  if (mk.us) {
    throw new Error("미국 주식 실매매는 아직 지원하지 않습니다.");
  }
  const toss = getTossTradingStatus();
  const bithumb = getBithumbTradingStatusForUserSync(program?.userId ?? "");
  if (mk.kr && !toss.configured) {
    throw new Error(
      toss.messageKo ??
        "국내 실매매에는 토스 API 키가 필요합니다.",
    );
  }
  if (mk.crypto && !bithumb.configured) {
    throw new Error(
      bithumb.messageKo ??
        "코인 실매매에는 빗썸 API 키가 필요합니다.",
    );
  }
  return { toss, bithumb, needsKr: Boolean(mk.kr), needsCrypto: Boolean(mk.crypto) };
}
