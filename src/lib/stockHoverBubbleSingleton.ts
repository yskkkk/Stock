import { useEffect } from "react";

/** 종목 호버 말풍선 — 동시에 하나만 (실적 레일·종목보관 등) */
export const STOCK_HOVER_BUBBLE_OPEN_EVENT = "ystock-stock-hover-bubble-open";

export type StockHoverBubbleOpenDetail = {
  ownerId: string;
  symbol: string;
};

export function readStockHoverBubbleOpenEvent(
  e: Event,
): StockHoverBubbleOpenDetail | undefined {
  return (e as CustomEvent<StockHoverBubbleOpenDetail>).detail;
}

export function dispatchStockHoverBubbleOpen(
  detail: StockHoverBubbleOpenDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<StockHoverBubbleOpenDetail>(STOCK_HOVER_BUBBLE_OPEN_EVENT, {
      detail,
    }),
  );
}

/** 말풍선·주식수량 모달 — 심볼 비교용 (`.KS`/`.KQ` 무시) */
export function stockBubbleSymbolKey(symbol: string | null | undefined): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(KS|KQ)$/i, "");
}

export function isSameStockBubbleSymbol(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = stockBubbleSymbolKey(a);
  const kb = stockBubbleSymbolKey(b);
  return Boolean(ka && kb && ka === kb);
}

type StockHoverChildBubbleApi = {
  openSymbol: string | null;
  closeShareStructureModal?: () => void;
  closeValueInvestBubble?: () => void;
};

/** 원래 말풍선 본문 클릭 — 주식수량 열림이면 수량만 닫기(부모 유지), 버핏만 열림이면 버핏만 닫기 */
export function handleStockHoverParentBubbleClick(
  e: { target: EventTarget | null },
  symbol: string,
  shareStructure: StockHoverChildBubbleApi | null,
  valueInvest: StockHoverChildBubbleApi | null,
): void {
  const target = e.target as HTMLElement | null;
  if (!target || target.closest("button, a")) return;

  if (
    shareStructure?.closeShareStructureModal &&
    isSameStockBubbleSymbol(symbol, shareStructure.openSymbol)
  ) {
    shareStructure.closeShareStructureModal();
    return;
  }
  if (
    valueInvest?.closeValueInvestBubble &&
    isSameStockBubbleSymbol(symbol, valueInvest.openSymbol)
  ) {
    valueInvest.closeValueInvestBubble();
  }
}

export function useStockHoverBubbleExclusive(
  ownerId: string,
  onClose: () => void,
): void {
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = readStockHoverBubbleOpenEvent(e);
      if (detail && detail.ownerId !== ownerId) onClose();
    };
    window.addEventListener(STOCK_HOVER_BUBBLE_OPEN_EVENT, onOpen);
    return () =>
      window.removeEventListener(STOCK_HOVER_BUBBLE_OPEN_EVENT, onOpen);
  }, [ownerId, onClose]);
}

export const STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT =
  "ystock-stock-hover-bubble-force-close";

/** @deprecated use STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT */
export const STOCK_VAULT_BUBBLE_CLOSE_EVENT = STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT;

export function dispatchForceCloseStockHoverBubble(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STOCK_HOVER_BUBBLE_FORCE_CLOSE_EVENT));
}

/** @deprecated use dispatchForceCloseStockHoverBubble */
export const dispatchCloseStockVaultBubble = dispatchForceCloseStockHoverBubble;
