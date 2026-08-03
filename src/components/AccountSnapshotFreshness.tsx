import { useEffect, useState } from "react";
import { ko } from "../i18n/ko";
import { formatTimeMsKst, formatUpdatedAt } from "../lib/format";

export function useSnapshotFreshness(syncing: boolean, slowMs = 1200) {
  const [slowFetch, setSlowFetch] = useState(false);
  const [freshnessTick, setFreshnessTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setFreshnessTick((t) => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!syncing) {
      setSlowFetch(false);
      return;
    }
    const id = window.setTimeout(() => setSlowFetch(true), slowMs);
    return () => window.clearTimeout(id);
  }, [syncing, slowMs]);

  return { slowFetch, freshnessTick };
}

type AccountSnapshotFreshnessProps = {
  syncing: boolean;
  updatedAtMs: number | null;
  err?: string | null;
  hasData?: boolean;
  slowMs?: number;
  /** compact: dock·거래내역 한 줄 / detailed: 계좌관리(상대·절대 시각 분리) */
  variant?: "compact" | "detailed";
  className?: string;
  staleHintClassName?: string;
};

export default function AccountSnapshotFreshness({
  syncing,
  updatedAtMs,
  err = null,
  hasData = true,
  slowMs = 1200,
  variant = "compact",
  className = "panel-freshness",
  staleHintClassName = "panel-freshness__stale-hint",
}: AccountSnapshotFreshnessProps) {
  const { slowFetch, freshnessTick } = useSnapshotFreshness(syncing, slowMs);

  if (!hasData) return null;

  const showSpinner = syncing && slowFetch;
  const statusText =
    syncing && slowFetch
      ? ` · ${ko.app.accountManageRefreshing}`
      : updatedAtMs
        ? variant === "detailed"
          ? ` · ${formatUpdatedAt(updatedAtMs)}`
          : ` · ${formatUpdatedAt(updatedAtMs)} · ${formatTimeMsKst(updatedAtMs)}`
        : syncing
          ? "…"
          : "";

  const freshnessEl =
    variant === "detailed" ? (
      <span
        className={className}
        role="status"
        aria-live="polite"
        aria-busy={syncing || undefined}
      >
        {showSpinner ? (
          <span
            className="account-manage-tab__refresh-spinner account-manage-tab__refresh-spinner--freshness"
            aria-hidden
          />
        ) : null}
        <span
          className="account-manage-tab__freshness-text"
          data-freshness-tick={freshnessTick}
        >
          {ko.app.accountManageUpdated}
          {statusText}
        </span>
        {updatedAtMs ? (
          <time
            className="account-manage-tab__freshness-time"
            dateTime={new Date(updatedAtMs).toISOString()}
          >
            {formatTimeMsKst(updatedAtMs)}
          </time>
        ) : null}
      </span>
    ) : (
      <p
        className={className}
        role="status"
        aria-live="polite"
        aria-busy={syncing || undefined}
        data-freshness-tick={freshnessTick}
      >
        {showSpinner ? (
          <span className="panel-freshness__spinner" aria-hidden />
        ) : null}
        {ko.app.accountManageUpdated}
        {statusText}
      </p>
    );

  return (
    <>
      {freshnessEl}
      {err && hasData ? (
        <p className={staleHintClassName} role="status">
          {err}
        </p>
      ) : null}
    </>
  );
}
