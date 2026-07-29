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

/** 켜진 시장별 주문 합계 — 확인 다이얼로그·실행 버튼 부제에 미리보기와 동일 포맷 */
export function summarizeRebalancePlanTotals(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  const parts: string[] = [];
  for (const m of enabledMarkets) {
    const plan = plans.find((p) => p.market === m);
    if (!plan || plan.orders.length === 0) continue;
    const total = plan.orders.reduce((s, o) => s + o.amount, 0);
    parts.push(formatRebalanceMoney(total, plan.currency));
  }
  return parts.join(" · ");
}

export function buildRebalanceNowConfirmMessage(
  plans: TossRebalanceBuyPlan[],
  enabledMarkets: Array<"kr" | "us">,
): string {
  const amountNote = rebalanceAmountNote();
  const summary = summarizeRebalancePlanTotals(plans, enabledMarkets);
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
