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

export const STOCK_VAULT_BUBBLE_CLOSE_EVENT = "ystock-stock-vault-bubble-close";

export function dispatchCloseStockVaultBubble(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STOCK_VAULT_BUBBLE_CLOSE_EVENT));
}
