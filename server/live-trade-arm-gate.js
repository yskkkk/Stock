import { getBithumbTradingStatus } from "./bithumb-trading-adapter.js";
import { getTossTradingStatus } from "./toss-trading-adapter.js";

/**
 * 실매매 시작 전 시장별 연동 요건 검사.
 * @param {import("./live-trade-programs-store.js").LiveTradeProgram} program
 */
export function validateLiveTradeArmGate(program) {
  const mk = program?.markets ?? {};
  const needsKr = Boolean(mk.kr);
  const needsUs = Boolean(mk.us);
  const needsCrypto = Boolean(mk.crypto);

  if (!needsKr && !needsUs && !needsCrypto) {
    throw new Error("국내·미국·코인 중 하나 이상을 선택하세요.");
  }
  if (needsUs) {
    throw new Error("미국 주식 실매매는 아직 지원하지 않습니다.");
  }

  const toss = getTossTradingStatus();
  const bithumb = getBithumbTradingStatus();

  if (needsKr && !toss.configured) {
    throw new Error(
      toss.messageKo ??
        "국내 실매매에는 토스 API 키가 필요합니다. 서버 .env를 확인하세요.",
    );
  }
  if (needsCrypto && !bithumb.configured) {
    throw new Error(
      bithumb.messageKo ??
        "코인 실매매에는 빗썸 API 키가 필요합니다. 서버 .env를 확인하세요.",
    );
  }

  return { toss, bithumb, needsKr, needsCrypto };
}
