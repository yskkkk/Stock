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

/** 켜진 시장별 cashToSpend — 미리보기 「이번 사용」과 동일 포맷 */
export function buildRebalanceSpendSummary(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  const parts: string[] = [];
  for (const m of enabledMarkets) {
    const plan = plans.find((p) => p.market === m);
    if (!plan) continue;
    parts.push(
      ko.app.accountManageRebalanceSpendLine
        .replace("{cashLabel}", rebalanceCashLabel(plan.currency))
        .replace(
          "{spend}",
          formatRebalanceMoney(plan.cashToSpend, plan.currency),
        ),
    );
  }
  return parts.join(" · ");
}

/** @deprecated buildRebalanceSpendSummary 사용 — 하위 호환 alias */
export function summarizeRebalancePlanTotals(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  return buildRebalanceSpendSummary(plans, enabledMarkets);
}

/** 실행 버튼 위 요약 — 미리보기 「이번 사용」·수수료 안내와 동일 포맷 */
export function buildRebalanceRunSummaryLine(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string | null {
  const summary = buildRebalanceSpendSummary(plans, enabledMarkets);
  if (!summary) return null;
  return withRebalanceAmountNote(
    ko.app.accountManageRebalanceNowRunSummary.replace("{summary}", summary),
  );
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

/** 실행 버튼 부제 — 미리보기 합계·amountNote를 동일 포맷으로 (합계는 별도 줄이 있으면 생략) */
export function buildRebalanceNowRunSubLabel(
  summary?: string | null,
  opts?: { repeatSummary?: boolean },
): string {
  if (summary && opts?.repeatSummary !== false) {
    return withRebalanceAmountNote(ko.app.accountManageRebalanceNowRunSubAmount, {
      summary,
    });
  }
  return withRebalanceAmountNote(ko.app.accountManageRebalanceNowRunSub);
}
