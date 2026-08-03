import type { TossRebalanceBuyPlan } from "../api";
import { ko } from "../i18n/ko";
import { formatPrice } from "./format";

/** 리밸런스 미리보기·즉시 매수 공통 금액 표기 (시장별 원통화) */
export function formatRebalanceMoney(
  amount: number,
  currency: "KRW" | "USD",
): string {
  return formatPrice(amount, currency);
}

export function rebalanceCashLabel(currency: "KRW" | "USD"): string {
  return currency === "USD"
    ? ko.app.accountManageRebalanceCashUsd
    : ko.app.accountManageRebalanceCashKrw;
}

/** 통화·수수료 반영 여부 — 미리보기·확인·실행 버튼에서 동일 문구 */
export function rebalanceAmountNote(): string {
  return ko.app.accountManageRebalanceAmountNote;
}

export function withRebalanceAmountNote(
  template: string,
  extra?: Record<string, string>,
): string {
  let out = template.replace("{amountNote}", rebalanceAmountNote());
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      out = out.replace(`{${key}}`, value);
    }
  }
  return out;
}

export type RebalanceSpendLine = {
  market: "kr" | "us";
  cashLabel: string;
  spend: string;
};

/** 켜진 시장별 cashToSpend — UI에서 시장·통화별로 분리 표시 */
export function buildRebalanceSpendLines(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): RebalanceSpendLine[] {
  const lines: RebalanceSpendLine[] = [];
  for (const m of enabledMarkets) {
    const plan = plans.find((p) => p.market === m);
    if (!plan) continue;
    lines.push({
      market: m,
      cashLabel: rebalanceCashLabel(plan.currency),
      spend: formatRebalanceMoney(plan.cashToSpend, plan.currency),
    });
  }
  return lines;
}

function formatRebalanceSpendLine(line: RebalanceSpendLine): string {
  return ko.app.accountManageRebalanceSpendLine
    .replace("{cashLabel}", line.cashLabel)
    .replace("{spend}", line.spend);
}

/** 켜진 시장별 cashToSpend — 확인 대화상자 등 여러 줄 텍스트용 */
export function buildRebalanceSpendSummary(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  return buildRebalanceSpendLines(plans, enabledMarkets)
    .map(formatRebalanceSpendLine)
    .join("\n");
}

/** 켜진 시장별 cashToSpend — 버튼 부제·좁은 UI 한 줄용 */
export function buildRebalanceSpendSummaryInline(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  return buildRebalanceSpendLines(plans, enabledMarkets)
    .map(formatRebalanceSpendLine)
    .join(" · ");
}

/** @deprecated buildRebalanceSpendSummary 사용 — 하위 호환 alias */
export function summarizeRebalancePlanTotals(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  return buildRebalanceSpendSummary(plans, enabledMarkets);
}

/** 미리보기·즉시 매수 spend 목록 위 공통 lead (통화·수수료 동일 포맷) */
export function buildRebalanceSharedSpendLead(): string {
  return withRebalanceAmountNote(ko.app.accountManageRebalanceSharedSpendLead);
}

/** @deprecated buildRebalanceSharedSpendLead — compact 툴바·모달 공통 */
export function buildRebalanceSpendSummaryLead(): string {
  return buildRebalanceSharedSpendLead();
}

/** @deprecated buildRebalanceSharedSpendLead — 모달 미리보기 섹션 */
export function buildRebalancePreviewRunSummaryLead(): string {
  return buildRebalanceSharedSpendLead();
}

/** @deprecated buildRebalanceSharedSpendLead — 즉시 매수 foot */
export function buildRebalanceRunSummaryLead(): string {
  return buildRebalanceSharedSpendLead();
}

/** @deprecated buildRebalanceSharedSpendLead */
export function buildRebalancePreviewSummaryLead(): string {
  return buildRebalanceSharedSpendLead();
}

export function buildRebalanceNowConfirmMessage(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  const amountNote = rebalanceAmountNote();
  const summary = buildRebalanceSpendSummary(plans, enabledMarkets);
  if (summary) {
    return ko.app.accountManageRebalanceNowConfirm
      .replace("{summary}", summary)
      .replace("{amountNote}", amountNote);
  }
  return ko.app.accountManageRebalanceNowConfirmGeneric.replace(
    "{amountNote}",
    amountNote,
  );
}

type RebalanceSubLabelOpts = {
  repeatSummary?: boolean;
  /** spend 합계 블록에 amountNote가 이미 있으면 버튼 부제는 역할만 */
  skipAmountNote?: boolean;
};

/** 실행 버튼 부제 — 미리보기 합계·amountNote를 동일 포맷으로 (합계는 별도 줄이 있으면 생략) */
export function buildRebalanceNowRunSubLabel(
  summary?: string | null,
  opts?: RebalanceSubLabelOpts,
): string {
  if (opts?.skipAmountNote) {
    return ko.app.accountManageRebalanceNowRunSubBare;
  }
  if (summary && opts?.repeatSummary !== false) {
    return withRebalanceAmountNote(ko.app.accountManageRebalanceNowRunSubAmount, {
      summary,
    });
  }
  return withRebalanceAmountNote(ko.app.accountManageRebalanceNowRunSub);
}

/**
 * 계좌관리 툴바 「미리보기·스케줄」 부제 —
 * 합계가 있으면 합계+amountNote, 없으면 amountNote만 (실주문 ‘돈이 나갑니다’ 문구는 쓰지 않음)
 */
export function buildRebalancePreviewSubLabel(
  summary?: string | null,
  opts?: RebalanceSubLabelOpts,
): string {
  if (opts?.skipAmountNote) {
    return ko.app.accountManageRebalancePreviewSubBare;
  }
  const s = typeof summary === "string" ? summary.trim() : "";
  if (s && opts?.repeatSummary !== false) {
    return withRebalanceAmountNote(
      ko.app.accountManageRebalancePreviewSubAmount,
      { summary: s },
    );
  }
  return withRebalanceAmountNote(ko.app.accountManageRebalancePreviewSub);
}
