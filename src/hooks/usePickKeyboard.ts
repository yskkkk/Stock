import { useEffect } from "react";
import type { StockPick } from "../types";

export function usePickKeyboard(
  picks: StockPick[],
  selectedSymbol: string | null,
  onSelect: (pick: StockPick) => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || picks.length === 0) return;

    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();

      const idx = picks.findIndex((p) => p.symbol === selectedSymbol);
      const next =
        e.key === "ArrowDown"
          ? idx < 0
            ? 0
            : Math.min(picks.length - 1, idx + 1)
          : idx < 0
            ? picks.length - 1
            : Math.max(0, idx - 1);

      onSelect(picks[next]);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picks, selectedSymbol, onSelect, enabled]);
}
