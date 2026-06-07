import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";
import FavoriteTrackPanel from "./FavoriteTrackPanel";

export type FavoriteTrackPopoverData = {
  symbol: string;
  name: string;
  market: "kr" | "us";
  addedAtMs: number;
  favoritePrice: number | null;
  currentPrice: number | null;
  currency?: string;
};

type Props = {
  anchor: HTMLElement | null;
  data: FavoriteTrackPopoverData | null;
  onClose: () => void;
  onBasePriceSaved?: (symbol: string, price: number | null) => void;
};

export default function FavoriteTrackPopover({
  anchor,
  data,
  onClose,
  onBasePriceSaved,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !data) {
      setPos(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const popW = 280;
    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    let top = rect.bottom + 8;
    const popH = popRef.current?.offsetHeight ?? 160;
    if (top + popH > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popH - 8);
    }
    setPos({ top, left });
  }, [anchor, data]);

  useEffect(() => {
    if (!data) return;
    const onDocDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (anchor?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, data, onClose]);

  if (!data || !pos) return null;

  return createPortal(
    <div
      ref={popRef}
      className="favorite-track-popover"
      role="dialog"
      aria-label={`${data.name} ${ko.stockVault.favoriteTrackTitle}`}
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        type="button"
        className="favorite-track-popover__close"
        aria-label={ko.stockVault.favoriteTrackClose}
        onClick={onClose}
      >
        ×
      </button>
      <FavoriteTrackPanel
        symbol={data.symbol}
        market={data.market}
        addedAtMs={data.addedAtMs}
        basePrice={data.favoritePrice}
        currentPrice={data.currentPrice}
        currency={data.currency}
        editable
        onBasePriceSaved={(price) => onBasePriceSaved?.(data.symbol, price)}
      />
    </div>,
    document.body,
  );
}
