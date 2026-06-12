/** HMR·캐시 분할 시 Context 모듈 이중 로드 대비 — window 싱글톤 */

export type ValueInvestBubbleBridgeTarget = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  price?: number | null;
  currency?: string | null;
};

export type ValueInvestBubbleBridgeApi = {
  showValueInvestBubble: (
    anchor: HTMLElement,
    target: ValueInvestBubbleBridgeTarget,
  ) => void;
  closeValueInvestBubble: () => void;
  openSymbol: string | null;
};

const WIN_KEY = "__stockValueInvestBubbleApi";

export function registerValueInvestBubbleApi(
  api: ValueInvestBubbleBridgeApi | null,
): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  if (api) w[WIN_KEY] = api;
  else delete w[WIN_KEY];
}

export function readValueInvestBubbleApi(): ValueInvestBubbleBridgeApi | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as Record<string, unknown>)[WIN_KEY];
  if (!raw || typeof raw !== "object") return null;
  const api = raw as ValueInvestBubbleBridgeApi;
  if (typeof api.showValueInvestBubble !== "function") return null;
  return {
    ...api,
    openSymbol: api.openSymbol ?? null,
  };
}
