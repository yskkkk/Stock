import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  fetchLiveTradingMinuteQuotes,
  type LiveTradePortfolioResponse,
} from "../api";
import {
  mergeLiveQuotesIntoPortfolio,
  type LiveTradeFeeRateByMarket,
} from "../lib/livePortfolioLiveQuotes";
/** 보유 종목 현재가 — 시뮬·일반 */
export const PORTFOLIO_QUOTE_POLL_MS = 15_000;
/** 실매매(armed) — 거래소·시세 동기화 주기 */
export const LIVE_TRADE_ARMED_POLL_MS = 5_000;

/** 시뮬·포트폴리오 보유 종목 현재가 — 1분봉 폴링으로 실시간 반영 */
export function useLivePortfolioQuotePoll(
  portfolio: LiveTradePortfolioResponse | null,
  setPortfolio: Dispatch<SetStateAction<LiveTradePortfolioResponse | null>>,
  enabled: boolean,
  feeByMarket?: LiveTradeFeeRateByMarket,
  pollMs: number = PORTFOLIO_QUOTE_POLL_MS,
) {
  const symbolsKey = useMemo(
    () =>
      portfolio?.holdings
        .map((h) => String(h.symbol ?? "").trim().toUpperCase())
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
    const id = window.setInterval(pull, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbolsKey, enabled, setPortfolio, feeByMarket, pollMs]);
}
