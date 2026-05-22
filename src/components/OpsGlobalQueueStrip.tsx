import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useOpsDevQueueDisplay } from "../hooks/useOpsDevQueueDisplay";
import { ko } from "../i18n/ko";
import {
  agentEntriesSnapshotKey,
  readOpsDevQueueDisplayCache,
  rowsFromDevQueueDisplayPayload,
  sourceLabelForRow,
  writeOpsDevQueueDisplayCache,
  type OpsGlobalQueueRow,
} from "../lib/opsGlobalQueueRows";

function formatQueueTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function scrollQueueTrackToEnd(el: HTMLElement | null) {
  if (!el) return;
  const go = () => {
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = max;
  };
  go();
  requestAnimationFrame(() => {
    go();
    requestAnimationFrame(go);
  });
}

function OpsQueueUnifiedSeqBadge({ seq }: { seq?: number | null }) {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq < 1) return null;
  return (
    <span className="ops-agent-queue-card__seq" title={ko.app.opsUnifiedQueueSeqTitle}>
      #{seq}
    </span>
  );
}

export default function OpsGlobalQueueStrip({ onOpenOps }: { onOpenOps: () => void }) {
  const snap = useOpsDevQueueDisplay();
  const [rows, setRows] = useState<OpsGlobalQueueRow[]>(() => readOpsDevQueueDisplayCache() ?? []);
  const lastSnapKeyRef = useRef("");
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snap) return;
    const snapKey = agentEntriesSnapshotKey(snap.agentEntries);
    if (snapKey === lastSnapKeyRef.current) return;
    lastSnapKeyRef.current = snapKey;
    writeOpsDevQueueDisplayCache(snap);
    setRows(rowsFromDevQueueDisplayPayload(snap));
  }, [snap]);

  useLayoutEffect(() => {
    if (rows.length === 0) return;
    scrollQueueTrackToEnd(trackRef.current);
  }, [rows]);

  const openCard = useCallback(() => {
    onOpenOps();
  }, [onOpenOps]);

  const onCardKeyDown = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        onOpenOps();
      }
    },
    [onOpenOps],
  );

  return (
    <section
      className="ops-global-queue-stack card ops-management__server-queue"
      aria-label={ko.app.opsGlobalQueueTitle}
    >
      <h2 className="ops-global-queue-stack__heading">{ko.app.opsGlobalQueueTitle}</h2>
      <div
        ref={trackRef}
        className="ops-agent-queue-track ops-management__server-queue-track ops-global-queue-stack__track"
        role="list"
      >
        {rows.length === 0 ? (
          <p className="ops-global-queue-stack__empty">{ko.app.opsGlobalQueueEmpty}</p>
        ) : null}
        {rows.map((r) => {
          const aria = `${sourceLabelForRow(r)}. ${ko.app.opsGlobalQueueFieldProcessRank}: ${r.processRankDisplay}. ${ko.app.opsGlobalQueueFieldStatus}: ${r.statusLabel}. ${ko.app.opsGlobalQueueFieldTitle}: ${r.requestTitle}`;
          return (
            <div
              key={r.key}
              className={`ops-agent-queue-card ops-agent-queue-card--${r.cardClass} ops-global-queue-card`}
              role="listitem"
              tabIndex={0}
              aria-label={aria}
              onClick={openCard}
              onKeyDown={onCardKeyDown}
            >
              <div className="ops-global-queue-card__seq-row">
                <OpsQueueUnifiedSeqBadge seq={r.unifiedSeq} />
              </div>
              <dl className="ops-global-queue-card__fields">
                <div className="ops-global-queue-card__field">
                  <dt>{ko.app.opsGlobalQueueFieldProcessRank}</dt>
                  <dd
                    className="ops-global-queue-card__process-rank"
                    title={ko.app.opsUnifiedQueueSeqTitle}
                  >
                    {r.processRankDisplay}
                  </dd>
                </div>
                <div className="ops-global-queue-card__field">
                  <dt>{ko.app.opsGlobalQueueFieldSource}</dt>
                  <dd>{sourceLabelForRow(r)}</dd>
                </div>
                {!r.hideIp ? (
                  <div className="ops-global-queue-card__field">
                    <dt>{ko.app.opsGlobalQueueFieldIp}</dt>
                    <dd className="ops-management__stream-v--mono">{r.ipDisplay}</dd>
                  </div>
                ) : null}
                <div className="ops-global-queue-card__field ops-global-queue-card__field--status-time">
                  <dt>{ko.app.opsGlobalQueueFieldStatus}</dt>
                  <dd
                    className={`ops-global-queue-card__value ops-global-queue-card__value--${r.cardClass}`}
                  >
                    <span>{r.statusLabel}</span>
                    <span className="ops-global-queue-card__time">{formatQueueTime(r.timeMs)}</span>
                  </dd>
                </div>
                <div className="ops-global-queue-card__field ops-global-queue-card__field--title">
                  <dt>{ko.app.opsGlobalQueueFieldTitle}</dt>
                  <dd
                    className="ops-global-queue-card__title-dd"
                    title={
                      r.requestTitleFull.length > r.requestTitle.length
                        ? r.requestTitleFull
                        : undefined
                    }
                  >
                    {r.requestTitle}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}