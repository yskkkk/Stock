import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";
import { ko } from "../i18n/ko";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

export function LiveTradeExchangePicker({
  onSelect,
  compact = false,
}: {
  onSelect?: (exchange: LiveTradeTradesExchange) => void;
  /** 도크 패널 등 좁은 영역 */
  compact?: boolean;
}) {
  const pick = (exchange: LiveTradeTradesExchange) => {
    onSelect?.(exchange);
  };

  return (
    <div
      className={[
        "live-trade-exchange-picker",
        compact ? "live-trade-exchange-picker--compact" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={ko.app.liveTradeTradesPickExchange}
    >
      <p className="live-trade-exchange-picker__hint">
        {ko.app.liveTradeTradesPickExchange}
      </p>
      <div className="live-trade-exchange-picker__grid">
        <button
          type="button"
          className="live-trade-exchange-picker__card"
          onClick={() => pick("toss")}
        >
          <TossBrandMark className="live-trade-exchange-picker__mark" />
          <span className="live-trade-exchange-picker__name">
            {ko.app.liveTradeTossShort}
          </span>
        </button>
        <button
          type="button"
          className="live-trade-exchange-picker__card"
          onClick={() => pick("bithumb")}
        >
          <BithumbBrandMark className="live-trade-exchange-picker__mark" />
          <span className="live-trade-exchange-picker__name">
            {ko.app.liveTradeBithumbShort}
          </span>
        </button>
      </div>
    </div>
  );
}
