import { useMemo, useRef, useState } from "react";
import { useStickyNumber } from "../hooks/useStickyNumber";
import type { TossFeeRatesByMarket, TossTestHolding, TossTestSnapshot } from "../api";
import { ko } from "../i18n/ko";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { useTossSnapshotLiveQuotes } from "../hooks/useTossSnapshotLiveQuotes";
import { useUsdKrwRate } from "../hooks/useUsdKrwRate";
import {
  mergeTossFeeRates,
  tossFeeRatesFromLegacy,
  tossRoundTripForHolding,
} from "../lib/tossHoldingFeeRates";
import {
  computeTossAccountCombinedPnl,
  tossHoldingNetMarketValue,
  tossHoldingNetReturnPercent,
  tossHoldingNetUnrealizedPnl,
  tossHoldingsTotalNetMarketValueKrw,
} from "../lib/tossHoldingPnl";
import { LiveTradeSymbolCell } from "./LiveTradeSymbolCell";
import TossAccountOrderPanel, {
  type TossAccountOrderPanelHandle,
} from "./TossAccountOrderPanel";
import TossHoldingManageModal from "./TossHoldingManageModal";
import {
  formatLiveTradeQuantity,
  formatPercent,
  formatPrice,
  formatSignedMoney,
} from "../lib/format";

function formatUpdatedHmSs(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function holdingChgTone(pct: number | null | undefined): "up" | "down" | "flat" {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

function pnlTone(pnl: number | null | undefined): "up" | "down" | "flat" {
  if (pnl == null || !Number.isFinite(pnl)) return "flat";
  if (pnl > 0) return "up";
  if (pnl < 0) return "down";
  return "flat";
}

export default function TossAccountSnapshotCard({
  snapshot,
  feeLabelKo,
  tossRoundTripFeeRate = null,
  tossFeeRatesByMarket = null,
  updatedAtMs = null,
  variant = "inline",
  authenticated = true,
  liveOrdersEnabled = false,
  serverLiveOrdersEnabled = false,
  showOrders = true,
  onOrderChanged,
}: {
  snapshot: TossTestSnapshot;
  feeLabelKo?: string | null;
  /** 미지정 시 기본 왕복 수수료 */
  tossRoundTripFeeRate?: number | null;
  tossFeeRatesByMarket?: TossFeeRatesByMarket | null;
  updatedAtMs?: number | null;
  variant?: "inline" | "rail";
  authenticated?: boolean;
  liveOrdersEnabled?: boolean;
  serverLiveOrdersEnabled?: boolean;
  showOrders?: boolean;
  onOrderChanged?: () => void;
}) {
  const feeRates = useMemo(
    () =>
      mergeTossFeeRates(
        tossFeeRatesByMarket,
        tossFeeRatesFromLegacy(tossRoundTripFeeRate, tossFeeRatesByMarket?.source),
      ),
    [tossFeeRatesByMarket, tossRoundTripFeeRate],
  );
  const liveSnapshot = useTossSnapshotLiveQuotes(
    snapshot,
    Boolean(snapshot.holdings?.length),
    undefined,
    feeRates,
  );
  const { cash, summary, holdings } = liveSnapshot ?? snapshot;
  const needsFxRate = cash.usd > 0 || holdings.length > 0;
  const { rate: usdKrwRate, valuationDate: usdKrwValDate } = useUsdKrwRate(needsFxRate);
  const netSummary = useMemo(
    () =>
      computeTossAccountCombinedPnl(holdings, summary, usdKrwRate, feeRates),
    [holdings, summary, usdKrwRate, feeRates],
  );
  const holdingsTotalKrw = useMemo(
    () =>
      tossHoldingsTotalNetMarketValueKrw(holdings, summary, usdKrwRate, feeRates),
    [holdings, summary, usdKrwRate, feeRates],
  );
  const orderPanelRef = useRef<TossAccountOrderPanelHandle>(null);
  const [manageHolding, setManageHolding] = useState<TossTestHolding | null>(null);
  const [balanceHidden, toggleBalanceHidden] = useBithumbBalanceHidden();
  const isRail = variant === "rail";
  const rootClass = [
    "account-snapshot",
    "toss-account-snapshot",
    isRail ? "account-snapshot--rail bithumb-account-rail" : "live-trading-tab__cred-snapshot",
    authenticated ? "" : "live-trading-tab__cred-snapshot--unauth",
    balanceHidden ? "account-snapshot--balance-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const feesLine = feeLabelKo?.trim() || null;
  const plKrw = useStickyNumber(
    netSummary.profitLossKrw != null && Number.isFinite(netSummary.profitLossKrw)
      ? netSummary.profitLossKrw
      : null,
  );
  const plUp = plKrw != null && plKrw >= 0;
  const returnPct = useStickyNumber(
    netSummary.totalReturnPct != null && Number.isFinite(netSummary.totalReturnPct)
      ? netSummary.totalReturnPct
      : null,
  );
  const retUp = returnPct != null && returnPct >= 0;
  const holdingsTotalSticky = useStickyNumber(
    holdingsTotalKrw != null && Number.isFinite(holdingsTotalKrw)
      ? holdingsTotalKrw
      : null,
  );
  const cashKrw = useStickyNumber(
    cash?.krw != null && Number.isFinite(cash.krw) ? cash.krw : null,
  );
  const cashUsdKrw =
    cash.usd > 0 && usdKrwRate != null && usdKrwRate > 0
      ? Math.round(cash.usd * usdKrwRate)
      : null;
  const fxBasisTitle =
    usdKrwValDate != null && usdKrwValDate !== ""
      ? ko.app.quoteCurrencyFxBasis.replace("{date}", usdKrwValDate)
      : ko.app.topBarFxAria;

  return (
    <div className={rootClass} aria-label={ko.app.liveTradeTossAccountSectionAria}>
      {feesLine || (isRail && updatedAtMs != null && Number.isFinite(updatedAtMs)) ? (
        <div className="account-snapshot__meta">
          {feesLine ? (
            <span className="account-snapshot__fees" title={feesLine}>
              {ko.app.liveTradeFeeLabel}: {feesLine}
            </span>
          ) : (
            <span />
          )}
          {isRail && updatedAtMs != null && Number.isFinite(updatedAtMs) ? (
            <span className="account-snapshot__updated">
              {ko.app.leftRailTossUpdated}{" "}
              <time dateTime={new Date(updatedAtMs).toISOString()}>
                {formatUpdatedHmSs(updatedAtMs)}
              </time>
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="account-snapshot__balance-card">
        <header className="account-snapshot__balance-head">
          <h3 className="account-snapshot__balance-title">
            {ko.app.liveTradeCredTestBalance}
          </h3>
          <button
            type="button"
            className="account-snapshot__hide-btn"
            onClick={toggleBalanceHidden}
            aria-pressed={balanceHidden}
          >
            {balanceHidden
              ? ko.app.leftRailBithumbBalanceShow
              : ko.app.leftRailBithumbBalanceHide}
          </button>
        </header>

        <div className="account-snapshot__cash-grid">
          <div className="account-snapshot__cash-item">
            <span className="account-snapshot__cash-label">
              {ko.app.liveTradeTossCashKrw}
            </span>
            <span className="account-snapshot__cash-value" aria-hidden={balanceHidden || undefined}>
              {formatPrice(cashKrw ?? cash.krw, "KRW")}
            </span>
          </div>
          {cash.usd > 0 ? (
            <div className="account-snapshot__cash-item">
              <span className="account-snapshot__cash-label">
                {ko.app.liveTradeTossCashUsd}
              </span>
              <span className="account-snapshot__cash-value" aria-hidden={balanceHidden || undefined}>
                {formatPrice(cash.usd, "USD")}
              </span>
              {cashUsdKrw != null ? (
                <span
                  className="account-snapshot__cash-sub"
                  aria-hidden={balanceHidden || undefined}
                >
                  {formatPrice(cashUsdKrw, "KRW")}
                </span>
              ) : null}
              {usdKrwRate != null && usdKrwRate > 0 ? (
                <span className="account-snapshot__cash-fx" title={fxBasisTitle}>
                  {ko.app.liveTradeTossCashFxBasis.replace(
                    "{rate}",
                    formatPrice(usdKrwRate, "KRW"),
                  )}
                  {usdKrwValDate ? (
                    <>
                      {" · "}
                      {ko.app.topBarFxBasis.replace("{date}", usdKrwValDate)}
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {holdingsTotalSticky != null ? (
          <div className="account-snapshot__pl">
            <span className="account-snapshot__pl-label">
              {ko.app.liveTradeTossHoldingsTotalEval}
            </span>
            <span
              className="account-snapshot__pl-value account-snapshot__pl-value--money"
              aria-hidden={balanceHidden || undefined}
            >
              {formatPrice(holdingsTotalSticky, "KRW")}
            </span>
          </div>
        ) : null}

        {plKrw != null ? (
          <div
            className={`account-snapshot__pl${
              holdingsTotalSticky != null ? " account-snapshot__pl--compact" : ""
            }`}
          >
            <span className="account-snapshot__pl-label">
              {ko.app.liveTradePfUnrealized}
            </span>
            <span
              className={`account-snapshot__pl-value account-snapshot__pl-value--money ${
                plUp ? "account-snapshot__pl-value--up" : "account-snapshot__pl-value--down"
              }`}
              aria-hidden={balanceHidden || undefined}
            >
              {formatSignedMoney(plKrw, "KRW")}
            </span>
          </div>
        ) : null}
        {returnPct != null ? (
          <div className="account-snapshot__pl account-snapshot__pl--compact">
            <span className="account-snapshot__pl-label">
              {ko.app.liveTradePfReturn}
            </span>
            <span
              className={`account-snapshot__pl-value ${
                retUp ? "account-snapshot__pl-value--up" : "account-snapshot__pl-value--down"
              }`}
            >
              {formatPercent(returnPct)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="account-snapshot__holdings">
        <div className="account-snapshot__holdings-head">
          <h3 className="account-snapshot__holdings-title">
            {ko.app.liveTradeCredTestHoldings}
          </h3>
          {holdings.length > 0 ? (
            <span className="account-snapshot__holdings-count">{holdings.length}</span>
          ) : null}
        </div>
        {holdings.length === 0 ? (
          <p className="account-snapshot__empty">{ko.app.liveTradePfNoHoldings}</p>
        ) : (
          <ul className="account-snapshot__holdings-list">
            {holdings.map((h) => {
              const holdingFee = tossRoundTripForHolding(h.market, feeRates);
              const netReturn = tossHoldingNetReturnPercent(h, holdingFee);
              const tone = holdingChgTone(netReturn ?? h.returnPercent);
              const unrealizedPnl = tossHoldingNetUnrealizedPnl(h, holdingFee);
              const netMarketValue = tossHoldingNetMarketValue(h, holdingFee);
              const pnlUpDown = pnlTone(unrealizedPnl);
              const hasAvg =
                h.avgBuyPrice != null &&
                Number.isFinite(h.avgBuyPrice) &&
                h.avgBuyPrice > 0;
              const hasCur =
                h.currentPrice != null &&
                Number.isFinite(h.currentPrice) &&
                h.currentPrice > 0;
              return (
                <li key={`${h.market}-${h.symbol}`} className="account-snapshot__holding">
                  <div className="account-snapshot__holding-row">
                    <button
                      type="button"
                      className="account-snapshot__holding-open"
                      onClick={() => setManageHolding(h)}
                    >
                      <LiveTradeSymbolCell
                        symbol={h.symbol}
                        name={h.name}
                        market={h.market}
                        className="account-snapshot__holding-name"
                      />
                    </button>
                    {unrealizedPnl != null || netReturn != null ? (
                      <span className="account-snapshot__holding-pnl-wrap">
                        {unrealizedPnl != null ? (
                          <span
                            className={`account-snapshot__holding-pnl account-snapshot__holding-pnl--${pnlUpDown}`}
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatSignedMoney(unrealizedPnl, h.currency)}
                          </span>
                        ) : null}
                        {netReturn != null ? (
                          <span
                            className={`account-snapshot__holding-chg account-snapshot__holding-chg--${tone}`}
                          >
                            {formatPercent(netReturn)}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  <div className="account-snapshot__holding-row">
                    <span className="account-snapshot__holding-qty">
                      {formatLiveTradeQuantity(h.quantity, h.market)}주
                    </span>
                    {netMarketValue != null ? (
                      <span
                        className="account-snapshot__holding-val"
                        aria-hidden={balanceHidden || undefined}
                      >
                        {formatPrice(netMarketValue, h.currency)}
                      </span>
                    ) : null}
                    {showOrders && authenticated ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm account-snapshot__manage-btn"
                          onClick={() => setManageHolding(h)}
                        >
                          {ko.app.liveTradeTossHoldingManage}
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm account-snapshot__sell-btn"
                          onClick={() => orderPanelRef.current?.openSell(h)}
                        >
                          {ko.app.liveTradeTossOrderSell}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {hasAvg || hasCur ? (
                    <div className="account-snapshot__holding-prices">
                      {hasAvg ? (
                        <span>
                          {ko.app.liveTradePfColAvg}{" "}
                          <span
                            className="account-snapshot__holding-price-amt"
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatPrice(h.avgBuyPrice!, h.currency)}
                          </span>
                        </span>
                      ) : null}
                      {hasAvg && hasCur ? (
                        <span className="account-snapshot__holding-prices-sep">·</span>
                      ) : null}
                      {hasCur ? (
                        <span>
                          {ko.app.liveTradePfColCurrent}{" "}
                          <span
                            className="account-snapshot__holding-price-amt"
                            aria-hidden={balanceHidden || undefined}
                          >
                            {formatPrice(h.currentPrice!, h.currency)}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {showOrders && authenticated ? (
        <TossAccountOrderPanel
          ref={orderPanelRef}
          compact={isRail}
          liveOrdersEnabled={liveOrdersEnabled}
          serverLiveOrdersEnabled={serverLiveOrdersEnabled}
          onChanged={onOrderChanged}
        />
      ) : null}

      {manageHolding ? (
        <TossHoldingManageModal
          holding={manageHolding}
          liveOrdersEnabled={liveOrdersEnabled}
          serverLiveOrdersEnabled={serverLiveOrdersEnabled}
          onClose={() => setManageHolding(null)}
          onChanged={onOrderChanged}
        />
      ) : null}
    </div>
  );
}
