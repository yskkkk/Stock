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

/** 계좌관리 시세 — 잔고 API와 분리해 빠르게 폴링 */
export const TOSS_SNAPSHOT_QUOTE_POLL_MS = 500;
const QUOTE_FETCH_TIMEOUT_MS = 8_000;

export type TossSnapshotLiveQuotesResult = {
  snapshot: TossTestSnapshot | null;
  quotesUpdatedAtMs: number | null;
};

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
  const ledgerRef = useRef<TossTestSnapshot | null>(snapshot);
  const feeRatesRef = useRef(feeRates);
  const usdKrwRef = useRef(usdKrwRate);
  feeRatesRef.current = feeRates;
  usdKrwRef.current = usdKrwRate;

  const [liveSnapshot, setLiveSnapshot] = useState<TossTestSnapshot | null>(
    () => snapshot,
  );
  const [quotesUpdatedAtMs, setQuotesUpdatedAtMs] = useState<number | null>(null);

  const applyQuotes = useCallback((base: TossTestSnapshot) => {
    const merged = mergeLiveQuotesIntoTossSnapshot(
      base,
      quotesRef.current,
      usdKrwRef.current,
      feeRatesRef.current,
    );
    return merged === base ? { ...base, holdings: base.holdings.slice() } : merged;
  }, []);

  useEffect(() => {
    ledgerRef.current = snapshot;
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

  // 환율·수수료 바뀌면 현재 시세로 재계산
  useEffect(() => {
    const ledger = ledgerRef.current;
    if (!ledger || !symbolsKey) return;
    setLiveSnapshot(applyQuotes(ledger));
  }, [usdKrwRate, feeRates, symbolsKey, applyQuotes]);

  useEffect(() => {
    if (!enabled || !symbolsKey) {
      setQuotesUpdatedAtMs(null);
      return;
    }

    const syms = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;
    let inFlight = false;
    let abortCtrl: AbortController | null = null;

    const pull = () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      const timer = window.setTimeout(
        () => abortCtrl?.abort(),
        QUOTE_FETCH_TIMEOUT_MS,
      );

      void fetchLiveTradingMinuteQuotes(syms, { signal: abortCtrl.signal })
        .then((res) => {
          if (cancelled) return;
          quotesRef.current = res.quotes ?? {};
          const at =
            typeof res.updatedAtMs === "number" && res.updatedAtMs > 0
              ? res.updatedAtMs
              : Date.now();
          setQuotesUpdatedAtMs(at);
          const ledger = ledgerRef.current;
          if (!ledger) return;
          setLiveSnapshot(applyQuotes(ledger));
        })
        .catch(() => {
          /* 다음 틱 재시도 */
        })
        .finally(() => {
          window.clearTimeout(timer);
          inFlight = false;
        });
    };

    pull();
    const id = window.setInterval(pull, Math.max(400, pollMs));
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      window.clearInterval(id);
    };
  }, [enabled, symbolsKey, pollMs, applyQuotes]);

  return { snapshot: liveSnapshot, quotesUpdatedAtMs };
}
