import { memo, useEffect, useState } from "react";
import { formatTimeMsKst, formatUpdatedAt } from "../lib/format";
import { ko } from "../i18n/ko";

function PanelFreshnessRowInner({
  syncing = false,
  updatedAtMs = null,
  className,
  delayMs = 1200,
  compact = false,
}: {
  syncing?: boolean;
  updatedAtMs?: number | null;
  className?: string;
  /** 지연 후 스피너·갱신 중 문구 표시 */
  delayMs?: number;
  /** 좁은 레일 — KST 시각 생략 */
  compact?: boolean;
}) {
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
    const id = window.setTimeout(() => setSlowFetch(true), delayMs);
    return () => window.clearTimeout(id);
  }, [syncing, delayMs]);

  const showSpinner = syncing && slowFetch;
  const text =
    showSpinner
      ? `${ko.app.accountManageUpdated} · ${ko.app.accountManageRefreshing}`
      : updatedAtMs
        ? `${ko.app.accountManageUpdated} · ${formatUpdatedAt(updatedAtMs)}${
            !compact ? ` · ${formatTimeMsKst(updatedAtMs)}` : ""
          }`
        : syncing
          ? `${ko.app.accountManageUpdated}…`
          : ko.app.accountManageUpdated;

  return (
    <p
      className={["panel-freshness", className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-busy={syncing || undefined}
      data-freshness-tick={freshnessTick}
    >
      {showSpinner ? (
        <span className="panel-freshness__spinner" aria-hidden />
      ) : null}
      <span className="panel-freshness__text">{text}</span>
    </p>
  );
}

export default memo(PanelFreshnessRowInner);
