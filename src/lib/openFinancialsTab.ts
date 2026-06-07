export const OPEN_FINANCIALS_TAB_EVENT = "stock:open-financials-tab";

export type OpenFinancialsTabDetail = {
  symbol: string;
  name?: string;
  market: "kr" | "us";
};

export function dispatchOpenFinancialsTab(detail: OpenFinancialsTabDetail) {
  window.dispatchEvent(
    new CustomEvent<OpenFinancialsTabDetail>(OPEN_FINANCIALS_TAB_EVENT, { detail }),
  );
}
