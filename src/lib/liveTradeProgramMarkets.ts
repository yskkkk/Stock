/** 프로그램 등록 폼 — 시장(국내·미국·코인) 선택 */

export type ProgramMarketDraft = {
  marketsKr: boolean;
  marketsUs: boolean;
  marketsCrypto: boolean;
};

export type ProgramMarkets = {
  kr: boolean;
  us: boolean;
  crypto: boolean;
};

export function programMarketsFromDraft(d: ProgramMarketDraft): ProgramMarkets {
  return {
    kr: d.marketsKr,
    us: d.marketsUs,
    crypto: d.marketsCrypto,
  };
}

export function programMarketDraftFromMarkets(m: ProgramMarkets): ProgramMarketDraft {
  const n = normalizeExclusiveProgramMarkets(m);
  return {
    marketsKr: n.kr,
    marketsUs: n.us,
    marketsCrypto: n.crypto,
  };
}

/** 코인(빗썸)과 주식(토스·국내·미국)은 동시에 선택 불가 */
export function hasStockCryptoMarketConflict(m: ProgramMarkets): boolean {
  return Boolean(m.crypto && (m.kr || m.us));
}

/** 저장·표시용: 코인·주식이 겹치면 코인만 유지 */
export function normalizeExclusiveProgramMarkets(m: ProgramMarkets): ProgramMarkets {
  const kr = Boolean(m.kr);
  const us = Boolean(m.us);
  const crypto = Boolean(m.crypto);
  if (crypto && (kr || us)) {
    return { kr: false, us: false, crypto: true };
  }
  return { kr, us, crypto };
}

export type ProgramMarketDraftKey = keyof ProgramMarketDraft;

/** 시장 토글. 모두 해제되면 null */
export function toggleProgramMarketDraft(
  draft: ProgramMarketDraft,
  key: ProgramMarketDraftKey,
): ProgramMarketDraft | null {
  const turningOn = !draft[key];
  if (!turningOn) {
    const next = { ...draft, [key]: false };
    if (!next.marketsKr && !next.marketsUs && !next.marketsCrypto) {
      return null;
    }
    return next;
  }
  if (key === "marketsCrypto") {
    return { marketsKr: false, marketsUs: false, marketsCrypto: true };
  }
  return {
    ...draft,
    [key]: true,
    marketsCrypto: false,
  };
}
