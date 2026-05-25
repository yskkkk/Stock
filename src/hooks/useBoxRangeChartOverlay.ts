import { useEffect, useState } from "react";
import {
  fetchBoxRangeOverlay,
  type BoxRangeOverlayBox,
  type BoxRangeOverlayScan,
} from "../api";
import type { ChartTimeframe } from "../types";

export function useBoxRangeChartOverlay({
  symbol,
  chartTimeframe,
  chartEngine,
  enabled,
  refreshKey = 0,
}: {
  symbol: string | null | undefined;
  chartTimeframe: ChartTimeframe;
  chartEngine: "app" | "tradingview";
  enabled: boolean;
  /** 캔들 갱신 시 재조회 */
  refreshKey?: number;
}) {
  const [overlays, setOverlays] = useState<BoxRangeOverlayBox[]>([]);
  const [scan, setScan] = useState<BoxRangeOverlayScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    const sym = String(symbol ?? "").trim().toUpperCase();
    if (!enabled || chartEngine !== "app" || !sym) {
      setOverlays([]);
      setScan(null);
      setLoading(false);
      setNeedsLogin(false);
      return;
    }

    let cancelled = false;
    const load = () => {
      setLoading(true);
      fetchBoxRangeOverlay(sym, chartTimeframe)
        .then((r) => {
          if (cancelled) return;
          setOverlays(r.boxes ?? []);
          setScan(r.scan ?? null);
          setNeedsLogin(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setOverlays([]);
          setScan(null);
          const msg = e instanceof Error ? e.message : String(e);
          setNeedsLogin(/401|로그인|auth/i.test(msg));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const id = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, chartTimeframe, chartEngine, enabled, refreshKey]);

  return { overlays, scan, loading, needsLogin };
}
