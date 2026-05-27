import { ko } from "../i18n/ko";
import { dispatchLiveTradeDockOpenAccount } from "../lib/liveTradeDockAccount";
import type { LiveTradeTradesExchange } from "../lib/liveTradeTradesWorkspace";

export default function LiveTradeApiNotConnectedNotice({
  exchange,
  showOpenButton = true,
  className = "",
}: {
  exchange: LiveTradeTradesExchange;
  showOpenButton?: boolean;
  className?: string;
}) {
  const label =
    exchange === "bithumb"
      ? ko.app.liveTradeBithumbShort
      : ko.app.liveTradeTossShort;

  return (
    <div
      className={["live-trade-api-not-connected", className].filter(Boolean).join(" ")}
      role="status"
    >
      <p className="live-trade-api-not-connected__text">
        {label} {ko.app.liveTradeApiNotConnected}
      </p>
      {showOpenButton ? (
        <button
          type="button"
          className="btn btn--secondary live-trade-api-not-connected__btn"
          onClick={() =>
            dispatchLiveTradeDockOpenAccount({ provider: exchange })
          }
        >
          {ko.app.liveTradeApiConnectCta}
        </button>
      ) : null}
    </div>
  );
}
