import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLiveTradingMinuteQuotes,
  type TossFeeRatesByMarket,
  type TossTestSnapshot,
} from "../api";
import {
  mergeLiveQuotesIntoTossSnapshot,
  mergeTossLedgerPreserveLiveQuotes,
  tossSnapshotSymbolKey,
} from "../lib/tossSnapshotLiveQuotes";
import { useUsdKrwRate } from "./useUsdKrwRate";

/** 계좌관리·토스 보유 시세 — 최대한 실시간에 가깝게 1초 폴링 */
export const TOSS_SNAPSHOT_QUOTE_POLL_MS = 1_000;

export type TossSnapshotLiveQuotesResult = {
  snapshot: TossTestSnapshot | null;
  /** 시세 API 마지막 성공 시각(ms) */
  quotesUpdatedAtMs: number | null;
};

/** 토스 보유·평가 손익 — 시세 API로 1초 갱신 (계좌 API와 분리) */
export function useTossSnapshotLiveQuotes(
  snapshot: TossTestSnapshot | null,
  enabled = true,
  pollMs = TOSS_SNAPSHOT_QUOTE_POLL_MS,
  feeRates?: TossFeeRatesByMarket | null,
): TossSnapshotLiveQuotesResult {
  const symbolsKey = useMemo(() => tossSnapshotSymbolKey(snapshot), [snapshot]);
  const hasHoldings = Boolean(symbolsKey);
  const { rate: usdKrwRate } = useUsdKrwRate(hasHoldings && enabled);
  const quotesRef = useRef<import("../types").PicksDailyHistoryQuotesMap>({});
  const [liveSnapshot, setLiveSnapshot] = useState<TossTestSnapshot | null>(
    () => snapshot,
  );
  const [quotesUpdatedAtMs, setQuotesUpdatedAtMs] = useState<number | null>(null);

  const applyQuotes = useCallback(
    (base: TossTestSnapshot) =>
      mergeLiveQuotesIntoTossSnapshot(
        base,
        quotesRef.current,
        usdKrwRate,
        feeRates,
      ),
    [usdKrwRate, feeRates],
  );

  useEffect(() => {
    if (!snapshot) {
      setLiveSnapshot(null);
      return;
    }
    setLiveSnapshot((prev) => {
      const base =
        prev && tossSnapshotSymbolKey(prev) === symbolsKey && symbolsKey
          ? mergeTossLedgerPreserveLiveQuotes(snapshot, prev)
          : snapshot;
      return applyQuotes(base);
    });
  }, [snapshot, symbolsKey, applyQuotes]);

  useEffect(() => {
    if (!enabled || !snapshot || !symbolsKey) {
      setQuotesUpdatedAtMs(null);
      return;
    }

    const syms = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;
    let inFlight = false;

    const pull = () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      void fetchLiveTradingMinuteQuotes(syms)
        .then((res) => {
          if (cancelled) return;
          quotesRef.current = res.quotes ?? {};
          const at =
            typeof res.updatedAtMs === "number" && res.updatedAtMs > 0
              ? res.updatedAtMs
              : Date.now();
          setQuotesUpdatedAtMs(at);
          setLiveSnapshot((prev) => {
            const base = prev ?? snapshot;
            return applyQuotes(base);
          });
        })
        .catch(() => {
          /* 이전 시세·손익 유지 */
        })
        .finally(() => {
          inFlight = false;
        });
    };

    pull();
    const id = window.setInterval(pull, Math.max(500, pollMs));
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, snapshot, symbolsKey, pollMs, applyQuotes]);

  return { snapshot: liveSnapshot, quotesUpdatedAtMs };
}
