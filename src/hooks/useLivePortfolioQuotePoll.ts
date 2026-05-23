import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  fetchLiveTradingMinuteQuotes,
  type LiveTradePortfolioResponse,
} from "../api";
import {
  mergeLiveQuotesIntoPortfolio,
  type LiveTradeFeeRateByMarket,
} from "../lib/livePortfolioLiveQuotes";
/** 보유 종목 현재가 — 장중 갱신용(스크리너 목록보다 짧은 주기) */
export const PORTFOLIO_QUOTE_POLL_MS = 15_000;

/** 시뮬·포트폴리오 보유 종목 현재가 — 1분봉 폴링으로 실시간 반영 */
export function useLivePortfolioQuotePoll(
  portfolio: LiveTradePortfolioResponse | null,
  setPortfolio: Dispatch<SetStateAction<LiveTradePortfolioResponse | null>>,
  enabled: boolean,
  feeByMarket?: LiveTradeFeeRateByMarket,
) {
  const symbolsKey = useMemo(
    () =>
      portfolio?.holdings
        .map((h) => h.symbol.trim().toUpperCase())
        .sort()
        .join(",") ?? "",
    [portfolio?.holdings],
  );

  useEffect(() => {
    if (!enabled || !symbolsKey) return;
    const syms = symbolsKey.split(",").filter(Boolean);
    let cancelled = false;

    const pull = () => {
      void fetchLiveTradingMinuteQuotes(syms)
        .then((res) => {
          if (cancelled) return;
          setPortfolio((prev) =>
            prev
              ? mergeLiveQuotesIntoPortfolio(prev, res.quotes ?? {}, feeByMarket)
              : prev,
          );
        })
        .catch(() => {
          /* 이전 시세 유지 */
        });
    };

    pull();
    const id = window.setInterval(pull, PORTFOLIO_QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbolsKey, enabled, setPortfolio, feeByMarket]);
}
