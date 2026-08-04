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

/** 계좌관리 시세 폴링 간격 */
export const TOSS_SNAPSHOT_QUOTE_POLL_MS = 500;
const QUOTE_FETCH_TIMEOUT_MS = 6_000;

export type TossSnapshotLiveQuotesResult = {
  snapshot: TossTestSnapshot | null;
  quotesUpdatedAtMs: number | null;
};

/** 동일 심볼 집합에 대해 동시에 1건만 요청 */
const quoteInflight = new Map<
  string,
  Promise<{
    quotes: import("../types").PicksDailyHistoryQuotesMap;
    updatedAtMs: number;
  }>
>();

function fetchQuotesCoalesced(symbolsKey: string, syms: string[], signal: AbortSignal) {
  const existing = quoteInflight.get(symbolsKey);
  if (existing) return existing;
  const p = fetchLiveTradingMinuteQuotes(syms, { signal })
    .then((res) => ({
      quotes: res.quotes ?? {},
      updatedAtMs:
        typeof res.updatedAtMs === "number" && res.updatedAtMs > 0
          ? res.updatedAtMs
          : Date.now(),
    }))
    .finally(() => {
      quoteInflight.delete(symbolsKey);
    });
  quoteInflight.set(symbolsKey, p);
  return p;
}

/**
 * 토스 보유·평가 — 시세 API를 완료 후 500ms 간격으로 연속 폴링(잔고 API와 분리).
 */
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
    // 가격이 같아도 새 객체 → 요약 금액·등락률 리렌더
    if (merged === base) {
      return {
        ...base,
        holdings: base.holdings.map((h) => ({ ...h })),
        summary: base.summary ? { ...base.summary } : base.summary,
      };
    }
    return {
      ...merged,
      holdings: merged.holdings.map((h) => ({ ...h })),
      summary: merged.summary ? { ...merged.summary } : merged.summary,
    };
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortCtrl: AbortController | null = null;
    const gap = Math.max(400, pollMs);

    const tick = async () => {
      if (cancelled) return;
      abortCtrl?.abort();
      abortCtrl = new AbortController();
      const hard = window.setTimeout(
        () => abortCtrl?.abort(),
        QUOTE_FETCH_TIMEOUT_MS,
      );
      try {
        const res = await fetchQuotesCoalesced(
          symbolsKey,
          syms,
          abortCtrl.signal,
        );
        if (cancelled) return;
        quotesRef.current = res.quotes;
        setQuotesUpdatedAtMs(res.updatedAtMs);
        const ledger = ledgerRef.current;
        if (ledger) setLiveSnapshot(applyQuotes(ledger));
      } catch {
        /* 다음 틱 */
      } finally {
        window.clearTimeout(hard);
      }
      if (cancelled) return;
      timer = setTimeout(() => {
        void tick();
      }, gap);
    };

    void tick();
    return () => {
      cancelled = true;
      abortCtrl?.abort();
      if (timer != null) clearTimeout(timer);
    };
  }, [enabled, symbolsKey, pollMs, applyQuotes]);

  return { snapshot: liveSnapshot, quotesUpdatedAtMs };
}
