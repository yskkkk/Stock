/** 프로그램 등록 폼 — 시장(국내·미국·코인) 선택 (단일 선택) */

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
  return normalizeSingleProgramMarkets({
    kr: d.marketsKr,
    us: d.marketsUs,
    crypto: d.marketsCrypto,
  });
}

export function programMarketDraftFromMarkets(m: ProgramMarkets): ProgramMarketDraft {
  const n = normalizeSingleProgramMarkets(m);
  return {
    marketsKr: n.kr,
    marketsUs: n.us,
    marketsCrypto: n.crypto,
  };
}

export function countProgramMarketsSelected(m: ProgramMarkets): number {
  return [m.kr, m.us, m.crypto].filter(Boolean).length;
}

/** 저장·표시용: 정확히 하나만 유지 (코인 > 국내 > 미국, 없으면 국내) */
export function normalizeSingleProgramMarkets(m: ProgramMarkets): ProgramMarkets {
  if (m.crypto) return { kr: false, us: false, crypto: true };
  if (m.kr) return { kr: true, us: false, crypto: false };
  if (m.us) return { kr: false, us: true, crypto: false };
  return { kr: true, us: false, crypto: false };
}

/** @deprecated use normalizeSingleProgramMarkets */
export function normalizeExclusiveProgramMarkets(m: ProgramMarkets): ProgramMarkets {
  return normalizeSingleProgramMarkets(m);
}

export type ProgramMarketDraftKey = keyof ProgramMarketDraft;

/** 시장 단일 선택 (라디오) */
export function selectProgramMarketDraft(
  _draft: ProgramMarketDraft,
  key: ProgramMarketDraftKey,
): ProgramMarketDraft {
  return {
    marketsKr: key === "marketsKr",
    marketsUs: key === "marketsUs",
    marketsCrypto: key === "marketsCrypto",
  };
}

/** @deprecated use selectProgramMarketDraft */
export function toggleProgramMarketDraft(
  draft: ProgramMarketDraft,
  key: ProgramMarketDraftKey,
): ProgramMarketDraft {
  return selectProgramMarketDraft(draft, key);
}
