import { useEffect, useState } from "react";
import { fetchMarketIndices } from "../api";
import type { MarketIndexItem } from "../types";

const POLL_MS = 50_000;

export function useMarketIndices(enabled = true) {
  const [items, setItems] = useState<MarketIndexItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
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
    const tick = async () => {
      try {
        const data = await fetchMarketIndices();
        if (cancelled) return;
        setItems(data.items ?? []);
        setUpdatedAt(data.updatedAt ?? null);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return { items, updatedAt, loading, error };
}
