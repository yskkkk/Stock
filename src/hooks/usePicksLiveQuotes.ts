import { useEffect, useMemo, useState } from "react";
import { fetchPicksDailyHistoryQuotes, type PicksDailyHistoryQuotesMap } from "../api";
import { collectPickSymbols } from "../lib/mergePickQuotes";
import type { PicksResponse } from "../types";

/** 스크리너·추천 목록 1분봉 시세 폴링 주기 */
export const PICKS_LIST_QUOTE_POLL_MS = 60_000;

/**
 * picks 목록 심볼에 대해 /api/picks/daily-history/quotes(1분봉 스냅샷) 주기 갱신
 */
export function usePicksLiveQuotes(
  picks: PicksResponse | null,
  enabled = true,
): PicksDailyHistoryQuotesMap {
  const symbols = useMemo(() => collectPickSymbols(picks), [picks]);
  const symbolsKey = symbols.join(",");
  const [quotes, setQuotes] = useState<PicksDailyHistoryQuotesMap>({});

  useEffect(() => {
    if (!enabled || symbols.length === 0) {
      setQuotes({});
      return;
    }

    let cancelled = false;

    const pull = () => {
      void fetchPicksDailyHistoryQuotes(symbols)
        .then((res) => {
          if (cancelled || !res.quotes) return;
          setQuotes((prev) => ({ ...prev, ...res.quotes }));
        })
        .catch(() => {
          /* 이전 시세 유지 */
        });
    };

    pull();
    const id = window.setInterval(pull, PICKS_LIST_QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbolsKey, enabled, symbols]);

  return quotes;
}
