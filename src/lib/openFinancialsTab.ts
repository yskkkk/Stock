export const OPEN_FINANCIALS_TAB_EVENT = "stock:open-financials-tab";

export type OpenFinancialsTabDetail = {
  symbol: string;
  name?: string;
  market: "kr" | "us";
  /** 재무제표 탭 진입 후 해당 섹션으로 스크롤 */
  scrollTo?: "buffett";
};

export function dispatchOpenFinancialsTab(detail: OpenFinancialsTabDetail) {
  window.dispatchEvent(
    new CustomEvent<OpenFinancialsTabDetail>(OPEN_FINANCIALS_TAB_EVENT, { detail }),
  );
}
