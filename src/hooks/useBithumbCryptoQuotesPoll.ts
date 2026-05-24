import { useEffect, useMemo, useState } from "react";
import { fetchCryptoQuotes } from "../api";
import type { QuoteResponse } from "../types";

/** 보유·매매 카드 — 빗썸 KRW 공개 API 시세 */
export const BITHUMB_CRYPTO_QUOTE_POLL_MS = 1_000;

/**
 * BTC-USDT 등 코인 심볼 — `/api/crypto-quotes`(빗썸) 주기 갱신
 */
export function useBithumbCryptoQuotesPoll(symbols: string[], enabled = true) {
  const symbolsKey = useMemo(
    () =>
      [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [symbols],
  );
  const [quotes, setQuotes] = useState<Record<string, QuoteResponse>>({});

  useEffect(() => {
    if (!enabled || !symbolsKey) {
      setQuotes({});
      return;
    }
    const list = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;

    const pull = () => {
      void fetchCryptoQuotes(list)
        .then((res) => {
          if (cancelled || !res.quotes) return;
          setQuotes((prev) => ({ ...prev, ...res.quotes }));
        })
        .catch(() => {
          /* 이전 시세 유지 */
        });
    };

    pull();
    const id = window.setInterval(pull, BITHUMB_CRYPTO_QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbolsKey, enabled]);

  return quotes;
}
