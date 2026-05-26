import {
  isOrderAmountKrwValid,
  minOrderAmountKrwForMarkets,
} from "../constants/liveTradeOrder";
import { ko } from "../i18n/ko";
import { countProgramMarketsSelected } from "./liveTradeProgramMarkets";

export type LiveTradeProgramDraftFields = {
  name: string;
  modelId: string;
  marketsKr: boolean;
  marketsUs: boolean;
  marketsCrypto: boolean;
  maxOpenPositions: string;
  orderAmountKrw: string;
  orderAmountUsd: string;
};

export type LiveTradeProgramDraftValidateContext = {
  existingPrograms?: { id: string; name: string }[];
  editingProgramId?: string | null;
};

export function programNameCompareKey(name: string): string {
  return String(name ?? "").trim().toLowerCase();
}

export function hasDuplicateProgramName(
  name: string,
  programs: { id: string; name: string }[],
  excludeProgramId?: string | null,
): boolean {
  const key = programNameCompareKey(name);
  if (!key) return false;
  const exclude = String(excludeProgramId ?? "").trim();
  return programs.some(
    (p) => p.id !== exclude && programNameCompareKey(p.name) === key,
  );
}

/** @returns 1~50 정수, 빈 값·0·비정상이면 null */
export function parseMaxOpenPositionsInput(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 50) return null;
  return n;
}

function krwAmountFieldLabel(cryptoOnly: boolean): string {
  return cryptoOnly
    ? ko.app.liveTradeFieldAmountCrypto
    : ko.app.liveTradeFieldAmountKrw;
}

function usdAmountFieldLabel(marketsUs: boolean, marketsCrypto: boolean): string {
  if (marketsUs && marketsCrypto) return ko.app.liveTradeFieldAmountUsdCrypto;
  return ko.app.liveTradeFieldAmountUsd;
}

/**
 * 저장 버튼 활성·handleSave 공통 검증
 */
export function validateLiveTradeProgramDraft(
  draft: LiveTradeProgramDraftFields,
  context?: LiveTradeProgramDraftValidateContext,
):
  | { ok: true; maxOpenPositions: number; markets: { kr: boolean; us: boolean; crypto: boolean } }
  | { ok: false; message: string } {
  const name = draft.name.trim();
  if (!name) {
    return { ok: false, message: ko.app.liveTradeFieldNameRequired };
  }
  if (
    context?.existingPrograms?.length &&
    hasDuplicateProgramName(
      name,
      context.existingPrograms,
      context.editingProgramId,
    )
  ) {
    return { ok: false, message: ko.app.liveTradeProgramNameDuplicate };
  }
  const modelId = String(draft.modelId ?? "").trim();
  if (!modelId) {
    return { ok: false, message: ko.app.liveTradeFieldModelRequired };
  }
  const markets = {
    kr: draft.marketsKr,
    us: draft.marketsUs,
    crypto: draft.marketsCrypto,
  };
  if (countProgramMarketsSelected(markets) !== 1) {
    return { ok: false, message: ko.app.liveTradeFieldMarketsRequired };
  }
  const maxOpenPositions = parseMaxOpenPositionsInput(draft.maxOpenPositions);
  if (maxOpenPositions == null) {
    return { ok: false, message: ko.app.liveTradeFieldMaxPosInvalid };
  }
  const needsKrw = markets.kr || markets.crypto;
  const needsUsd = markets.us;
  if (needsKrw && !draft.orderAmountKrw.trim()) {
    return {
      ok: false,
      message: krwAmountFieldLabel(markets.crypto && !markets.kr),
    };
  }
  if (needsKrw && !isOrderAmountKrwValid(draft.orderAmountKrw, markets)) {
    const minKrw = minOrderAmountKrwForMarkets(markets);
    return {
      ok: false,
      message: markets.crypto
        ? `코인 1회 매수 금액은 ${minKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`
        : `1회 매수 금액은 ${minKrw.toLocaleString("ko-KR")}원 이상이어야 합니다.`,
    };
  }
  if (needsUsd && !draft.orderAmountUsd.trim()) {
    return {
      ok: false,
      message: usdAmountFieldLabel(markets.us, markets.crypto),
    };
  }
  return { ok: true, maxOpenPositions, markets };
}

export function liveTradeProgramDraftCanSave(
  draft: LiveTradeProgramDraftFields,
  context?: LiveTradeProgramDraftValidateContext,
): boolean {
  return validateLiveTradeProgramDraft(draft, context).ok;
}
