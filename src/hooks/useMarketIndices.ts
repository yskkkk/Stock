import { useEffect, useState } from "react";
import {
  peekMarketIndicesPrefetch,
  prefetchMarketIndices,
  refreshMarketIndices,
} from "../lib/tabPrefetch";
import type { MarketIndexItem } from "../types";

/** 환율·환율 계산과 동일 주기 */
const POLL_MS = 20_000;

export function useMarketIndices(enabled = true) {
  const seed = enabled ? peekMarketIndicesPrefetch() : null;
  const [items, setItems] = useState<MarketIndexItem[]>(() => seed?.items ?? []);
  const [updatedAt, setUpdatedAt] = useState<number | null>(
    () => seed?.updatedAt ?? null,
  );
  const [loading, setLoading] = useState(() => !(seed?.items?.length));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setUpdatedAt(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const apply = (data: { items: MarketIndexItem[]; updatedAt: number | null }) => {
      if (cancelled) return;
      setItems(data.items ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setError(null);
    };
    const tick = async (mode: "boot" | "poll") => {
      try {
        const data =
          mode === "boot"
            ? await prefetchMarketIndices()
            : await refreshMarketIndices();
        apply(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (!peekMarketIndicesPrefetch()?.items?.length) setLoading(true);
    void tick("boot");
    const id = window.setInterval(() => void tick("poll"), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return { items, updatedAt, loading, error };
}
