import { useEffect, useMemo, useState } from "react";
import {
  fetchPicksDailyHistoryQuotes,
  type PicksDailyHistoryQuotesMap,
} from "../api";
import { PICKS_LIST_QUOTE_POLL_MS } from "./usePicksLiveQuotes";

/**
 * 심볼 목록에 대해 1분봉 시세 스냅샷 주기 갱신 (추천·스크리너와 동일 주기)
 */
export function useSymbolLiveQuotes(symbols: string[], enabled = true) {
  const symbolsKey = useMemo(
    () =>
      [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [symbols],
  );
  const [quotes, setQuotes] = useState<PicksDailyHistoryQuotesMap>({});

  useEffect(() => {
    if (!enabled || !symbolsKey) {
      setQuotes({});
      return;
    }
    const list = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;

    const pull = () => {
      void fetchPicksDailyHistoryQuotes(list)
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
  }, [symbolsKey, enabled]);

  return quotes;
}
