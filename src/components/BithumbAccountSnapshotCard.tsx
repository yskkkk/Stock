import type { BithumbTestSnapshot } from "../api";
import { ko } from "../i18n/ko";
import { formatLiveTradeQuantity, formatPrice } from "../lib/format";

export type BithumbTradingFeesDisplay = {
  bidFee: number;
  askFee: number;
  roundTripFeeRate: number;
};

function feePct(n: number) {
  return `${(n * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

export default function BithumbAccountSnapshotCard({
  snapshot,
  tradingFees,
  feeLabelKo,
  variant = "inline",
}: {
  snapshot: BithumbTestSnapshot;
  tradingFees?: BithumbTradingFeesDisplay | null;
  /** API에서 조회한 수수료 라벨(저장된 fee 캐시) */
  feeLabelKo?: string | null;
  variant?: "inline" | "rail";
}) {
  const { krw, holdings } = snapshot;
  const rootClass =
    variant === "rail"
      ? "bithumb-account-rail"
      : "live-trading-tab__cred-snapshot";

  const feesLine =
    feeLabelKo ??
    (tradingFees
      ? `${ko.app.liveTradeFeeLabel}: 매수 ${feePct(tradingFees.bidFee)} · 매도 ${feePct(tradingFees.askFee)} (왕복 ${feePct(tradingFees.roundTripFeeRate)})`
      : null);

  return (
    <div className={rootClass} aria-label={ko.app.liveTradeCredTestBalance}>
      {feesLine ? (
        <p
          className={
            variant === "rail"
              ? "bithumb-account-rail__fees"
              : "live-trading-tab__cred-snapshot-fees"
          }
        >
          {feesLine}
        </p>
      ) : null}
      <p
        className={
          variant === "rail"
            ? "bithumb-account-rail__section-title"
            : "live-trading-tab__cred-snapshot-title"
        }
      >
        {ko.app.liveTradeCredTestBalance}
      </p>
      <dl className="live-trading-tab__cred-snapshot-krw bithumb-account-rail__krw">
        <div>
          <dt>{ko.app.liveTradeCredTestKrwTotal}</dt>
          <dd>{formatPrice(krw.total, "KRW")}</dd>
        </div>
        <div>
          <dt>{ko.app.liveTradeCredTestKrwAvailable}</dt>
          <dd>{formatPrice(krw.available, "KRW")}</dd>
        </div>
        {krw.locked > 0 ? (
          <div>
            <dt>{ko.app.liveTradeCredTestKrwLocked}</dt>
            <dd>{formatPrice(krw.locked, "KRW")}</dd>
          </div>
        ) : null}
      </dl>
      <p
        className={
          variant === "rail"
            ? "bithumb-account-rail__section-title"
            : "live-trading-tab__cred-snapshot-title"
        }
      >
        {ko.app.liveTradeCredTestHoldings}
      </p>
      {holdings.length === 0 ? (
        <p className="live-trading-tab__cred-snapshot-empty bithumb-account-rail__empty">
          {ko.app.liveTradeCredTestNoHoldings}
        </p>
      ) : (
        <ul className="live-trading-tab__cred-snapshot-holdings bithumb-account-rail__holdings">
          {holdings.map((h) => (
            <li key={h.currency}>
              <span className="live-trading-tab__cred-snapshot-coin">{h.name}</span>
              <span className="live-trading-tab__cred-snapshot-qty">
                {formatLiveTradeQuantity(h.quantity, "crypto")}
              </span>
              {h.avgBuyPrice != null ? (
                <span className="live-trading-tab__cred-snapshot-avg">
                  {ko.app.liveTradeCredTestAvgBuy}{" "}
                  {formatPrice(h.avgBuyPrice, "KRW")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
