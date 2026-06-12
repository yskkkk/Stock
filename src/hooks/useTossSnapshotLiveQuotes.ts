import { useEffect, useMemo, useState } from "react";
import { fetchLiveTradingMinuteQuotes, type TossTestSnapshot } from "../api";
import {
  mergeLiveQuotesIntoTossSnapshot,
  tossSnapshotSymbolKey,
} from "../lib/tossSnapshotLiveQuotes";
import { useUsdKrwRate } from "./useUsdKrwRate";

export const TOSS_SNAPSHOT_QUOTE_POLL_MS = 1_000;

/** 토스 보유·평가 손익 — 1분봉 시세로 1초 갱신 (계좌 API와 분리) */
export function useTossSnapshotLiveQuotes(
  snapshot: TossTestSnapshot | null,
  enabled = true,
  pollMs = TOSS_SNAPSHOT_QUOTE_POLL_MS,
): TossTestSnapshot | null {
  const symbolsKey = useMemo(() => tossSnapshotSymbolKey(snapshot), [snapshot]);
  const hasHoldings = Boolean(symbolsKey);
  const { rate: usdKrwRate } = useUsdKrwRate(hasHoldings && enabled);
  const [liveSnapshot, setLiveSnapshot] = useState<TossTestSnapshot | null>(
    () => snapshot,
  );

  useEffect(() => {
    if (snapshot) setLiveSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (!enabled || !snapshot || !symbolsKey) return;

    const syms = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;

    const pull = () => {
      void fetchLiveTradingMinuteQuotes(syms)
        .then((res) => {
          if (cancelled) return;
          setLiveSnapshot((prev) => {
            const base = prev ?? snapshot;
            return mergeLiveQuotesIntoTossSnapshot(
              base,
              res.quotes ?? {},
              usdKrwRate,
            );
          });
        })
        .catch(() => {
          /* 이전 시세·손익 유지 */
        });
    };

    pull();
    const id = window.setInterval(pull, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, snapshot, symbolsKey, usdKrwRate, pollMs]);

  return liveSnapshot;
}
