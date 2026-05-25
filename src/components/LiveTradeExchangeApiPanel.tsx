import type { AuthUser, LiveTradingStatusResponse } from "../api";
import { ko } from "../i18n/ko";
import {
  LiveTradeBithumbCredentialForm,
  LiveTradeTossCredentialForm,
} from "./LiveTradeAuthAndCredentials";

export type LiveTradeExchangeApiKind = "toss" | "bithumb";

function checklistStateClass(ok: boolean): string {
  return ok
    ? "live-trading-tab__toss-state live-trading-tab__toss-state--ok"
    : "live-trading-tab__toss-state live-trading-tab__toss-state--no";
}

export function LiveTradeExchangeApiPanel({
  exchange,
  status,
  user,
  onUpdated,
}: {
  exchange: LiveTradeExchangeApiKind;
  status: LiveTradingStatusResponse | null;
  user: AuthUser;
  onUpdated: () => void;
}) {
  if (exchange === "toss") {
    const toss = status?.toss;
    const tossReady = Boolean(toss?.ready);
    return (
      <div
        className={
          tossReady
            ? "live-trade-dock-api-panel live-trade-dock-api-panel--ready"
            : "live-trade-dock-api-panel live-trade-dock-api-panel--off"
        }
      >
        <h3 className="live-trade-dock-api-panel__title">{ko.app.liveTradeTossTitle}</h3>
        <p className="live-trade-dock-api-panel__summary">{toss?.messageKo ?? "—"}</p>
        <ul className="live-trading-tab__toss-env" aria-label={ko.app.liveTradeTossChecklist}>
          <li>
            <span>{ko.app.liveTradeTossItemApi}</span>
            <span className={checklistStateClass(Boolean(toss?.configured))}>
              {toss?.configured ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
            </span>
          </li>
          <li>
            <span>{ko.app.liveTradeTossItemAccount}</span>
            <span className={checklistStateClass(Boolean(toss?.ready))}>
              {toss?.ready ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
            </span>
          </li>
          <li>
            <span>{ko.app.liveTradeTossItemOrders}</span>
            <span
              className={checklistStateClass(status?.tossSimulatedOrders === false)}
            >
              {status?.tossSimulatedOrders === false
                ? ko.app.liveTradeTossOk
                : ko.app.liveTradeTossSim}
            </span>
          </li>
        </ul>
        <p className="live-trade-api-card__encrypt-note">{ko.app.liveTradeApiEncryptedNote}</p>
        <LiveTradeTossCredentialForm
          userId={user.id}
          tossReady={Boolean(toss?.ready)}
          cryptoReady={status?.credentialsCryptoReady !== false}
          onUpdated={onUpdated}
        />
      </div>
    );
  }

  const bithumb = status?.bithumb;
  const bithumbReady = Boolean(bithumb?.ready);
  return (
    <div
      className={
        bithumbReady
          ? "live-trade-dock-api-panel live-trade-dock-api-panel--ready"
          : "live-trade-dock-api-panel live-trade-dock-api-panel--off"
      }
    >
      <h3 className="live-trade-dock-api-panel__title">{ko.app.liveTradeBithumbTitle}</h3>
      <p className="live-trade-dock-api-panel__summary">{bithumb?.messageKo ?? "—"}</p>
      <ul
        className="live-trading-tab__toss-env"
        aria-label={ko.app.liveTradeBithumbChecklist}
      >
        <li>
          <span>{ko.app.liveTradeBithumbItemKey}</span>
          <span className={checklistStateClass(Boolean(bithumb?.configured))}>
            {bithumb?.configured ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
          </span>
        </li>
        <li>
          <span>{ko.app.liveTradeBithumbItemSecret}</span>
          <span className={checklistStateClass(Boolean(bithumb?.ready))}>
            {bithumb?.ready ? ko.app.liveTradeTossOk : ko.app.liveTradeTossNo}
          </span>
        </li>
      </ul>
      {status?.feeRates?.bithumb?.labelKo ? (
        <p className="live-trading-tab__hint live-trading-tab__fee-hint">
          {ko.app.liveTradeFeeLabel}: {status.feeRates.bithumb.labelKo}
        </p>
      ) : null}
      <p className="live-trade-api-card__encrypt-note">{ko.app.liveTradeApiEncryptedNote}</p>
      <LiveTradeBithumbCredentialForm
        userId={user.id}
        bithumbReady={Boolean(bithumb?.ready)}
        cryptoReady={status?.credentialsCryptoReady !== false}
        onUpdated={onUpdated}
      />
    </div>
  );
}
