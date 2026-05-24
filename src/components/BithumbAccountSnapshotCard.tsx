import type { BithumbTestSnapshot } from "../api";
import { ko } from "../i18n/ko";
import { useBithumbBalanceHidden } from "../hooks/useBithumbBalanceHidden";
import { formatLiveTradeQuantity, formatPercent, formatPrice } from "../lib/format";

export type BithumbTradingFeesDisplay = {
  bidFee: number;
  askFee: number;
  roundTripFeeRate: number;
};

function feePct(n: number) {
  return `${(n * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
}

function holdingReturnPercent(h: {
  returnPercent?: number | null;
  avgBuyPrice?: number | null;
  currentPrice?: number | null;
}): number | null {
  if (h.returnPercent != null && Number.isFinite(h.returnPercent)) {
    return h.returnPercent;
  }
  const avg = h.avgBuyPrice;
  const cur = h.currentPrice;
  if (avg == null || !(avg > 0) || cur == null || !(cur > 0)) return null;
  const pct = ((cur - avg) / avg) * 100;
  return Number.isFinite(pct) ? pct : null;
}
function holdingChangeTone(
  pct: number | null | undefined,
): "up" | "down" | "flat" {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > 0) return "up";
  if (pct < 0) return "down";
  return "flat";
}

function formatUpdatedHmSs(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function BithumbAccountSnapshotCard({
  snapshot,
  tradingFees,
  feeLabelKo,
  updatedAtMs = null,
  variant = "inline",
}: {
  snapshot: BithumbTestSnapshot;
  tradingFees?: BithumbTradingFeesDisplay | null;
  /** API에서 조회한 수수료 라벨(저장된 fee 캐시) */
  feeLabelKo?: string | null;
  /** 잔고·시세 마지막 반영 시각(ms) */
  updatedAtMs?: number | null;
  variant?: "inline" | "rail";
}) {
  const { krw, holdings } = snapshot;
  const [balanceHidden, toggleBalanceHidden] = useBithumbBalanceHidden();
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
      {variant === "rail" && updatedAtMs != null && Number.isFinite(updatedAtMs) ? (
        <p className="bithumb-account-rail__updated">
          {ko.app.leftRailBithumbUpdated}{" "}
          <time dateTime={new Date(updatedAtMs).toISOString()}>
            {formatUpdatedHmSs(updatedAtMs)}
          </time>
        </p>
      ) : null}
      <div
        className={
          variant === "rail"
            ? "bithumb-account-rail__balance-head"
            : "live-trading-tab__cred-snapshot-balance-head"
        }
      >
        <p
          className={
            variant === "rail"
              ? "bithumb-account-rail__section-title bithumb-account-rail__section-title--inline"
              : "live-trading-tab__cred-snapshot-title live-trading-tab__cred-snapshot-title--inline"
          }
        >
          {ko.app.liveTradeCredTestBalance}
        </p>
        <button
          type="button"
          className="bithumb-balance-hide-btn"
          onClick={toggleBalanceHidden}
          aria-pressed={balanceHidden}
        >
          {balanceHidden
            ? ko.app.leftRailBithumbBalanceShow
            : ko.app.leftRailBithumbBalanceHide}
        </button>
      </div>
      <dl
        className={`live-trading-tab__cred-snapshot-krw live-trading-tab__cred-snapshot-krw--pair bithumb-account-rail__krw${
          balanceHidden ? " bithumb-balance-values--hidden" : ""
        }`}
      >
        <div>
          <dt>{ko.app.liveTradeCredTestKrwTotal}</dt>
          <dd aria-hidden={balanceHidden || undefined}>{formatPrice(krw.total, "KRW")}</dd>
        </div>
        <div>
          <dt>{ko.app.liveTradeCredTestKrwAvailable}</dt>
          <dd aria-hidden={balanceHidden || undefined}>{formatPrice(krw.available, "KRW")}</dd>
        </div>
        {krw.locked > 0 ? (
          <div className="live-trading-tab__cred-snapshot-krw-locked">
            <dt>{ko.app.liveTradeCredTestKrwLocked}</dt>
            <dd aria-hidden={balanceHidden || undefined}>{formatPrice(krw.locked, "KRW")}</dd>
          </div>
        ) : null}
      </dl>
      {variant !== "rail" ? (
        <>
          <p className="live-trading-tab__cred-snapshot-title">
            {ko.app.liveTradeCredTestHoldings}
          </p>
      {holdings.length === 0 ? (
        <p className="live-trading-tab__cred-snapshot-empty">
          {ko.app.liveTradeCredTestNoHoldings}
        </p>
      ) : (
        <ul className="live-trading-tab__cred-snapshot-holdings">
          {holdings.map((h) => {
            const retPct = holdingReturnPercent(h);
            const tone = holdingChangeTone(retPct);
            return (
              <li key={h.currency}>
                <div className="live-trading-tab__cred-snapshot-holding-row">
                  <span className="live-trading-tab__cred-snapshot-coin">{h.name}</span>
                  {retPct != null ? (
                    <span
                      className={`live-trading-tab__cred-snapshot-chg live-trading-tab__cred-snapshot-chg--${tone}`}
                    >
                      {formatPercent(retPct)}
                    </span>
                  ) : null}
                </div>
                <div className="live-trading-tab__cred-snapshot-holding-row">
                  <span className="live-trading-tab__cred-snapshot-qty">
                    {formatLiveTradeQuantity(h.quantity, "crypto")}
                  </span>
                  {h.marketValue != null ? (
                    <span className="live-trading-tab__cred-snapshot-val">
                      <span className="live-trading-tab__cred-snapshot-val-label">
                        {ko.app.liveTradePfEval}
                      </span>{" "}
                      {formatPrice(h.marketValue, "KRW")}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
        </>
      ) : null}
    </div>
  );
}
