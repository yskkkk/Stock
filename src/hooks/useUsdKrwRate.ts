import { useEffect, useState } from "react";
import { fetchUsdKrw } from "../api";

const POLL_MS = 20_000;

/**
 * 미국 주식 원화 표시용 USD/KRW. 비활성화 시 rate는 null.
 */
export function useUsdKrwRate(enabled: boolean) {
  const [rate, setRate] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [valuationDate, setValuationDate] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRate(null);
      setUpdatedAt(null);
      setValuationDate(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const d = await fetchUsdKrw();
        if (cancelled) return;
        setRate(d.rate);
        setUpdatedAt(d.updatedAt);
        setValuationDate(d.valuationDate ?? null);
      } catch {
        if (!cancelled) {
          setRate(null);
          setUpdatedAt(null);
          setValuationDate(null);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return { rate, updatedAt, valuationDate };
}
