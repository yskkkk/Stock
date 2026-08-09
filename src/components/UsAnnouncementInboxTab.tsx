import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addUsAnnouncementWatch,
  fetchUsAnnouncements,
  seedUsAnnouncement,
  tickUsAnnouncements,
  type UsAnnouncementCard,
  type UsAnnouncementKind,
} from "../api";
import { ko } from "../i18n/ko";
import "./us-announcement-inbox-tab.css";

const KIND_FILTERS: Array<{ id: "" | UsAnnouncementKind; label: string }> = [
  { id: "", label: ko.usAnnouncement.filterAll },
  { id: "guidance", label: ko.usAnnouncement.kindGuidance },
  { id: "consensus", label: ko.usAnnouncement.kindConsensus },
  { id: "governance", label: ko.usAnnouncement.kindGovernance },
  { id: "earnings", label: ko.usAnnouncement.kindEarnings },
];

function kindLabel(kind: UsAnnouncementKind): string {
  switch (kind) {
    case "guidance":
      return ko.usAnnouncement.kindGuidance;
    case "consensus":
      return ko.usAnnouncement.kindConsensus;
    case "governance":
      return ko.usAnnouncement.kindGovernance;
    case "earnings":
      return ko.usAnnouncement.kindEarnings;
    default:
      return kind;
  }
}

function formatWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
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

function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pctClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "";
  if (pct > 0.5) return "us-ann-inbox__pct--up";
  if (pct < -0.5) return "us-ann-inbox__pct--down";
  return "";
}

export default function UsAnnouncementInboxTab() {
  const [cards, setCards] = useState<UsAnnouncementCard[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [kind, setKind] = useState<"" | UsAnnouncementKind>("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [watchInput, setWatchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(
    async (opts?: { symbol?: string; kind?: "" | UsAnnouncementKind }) => {
      setError(null);
      const sym =
        opts && "symbol" in opts ? opts.symbol ?? "" : symbolFilter;
      const k = opts && "kind" in opts ? opts.kind ?? "" : kind;
      try {
        const res = await fetchUsAnnouncements({
          kind: k || undefined,
          symbol: String(sym).trim() || undefined,
          limit: 100,
        });
        setCards(res.cards);
        setWatchlist(res.watchlist);
        setUpdatedAt(res.updatedAt);
        return res;
      } catch (e) {
        setError(e instanceof Error ? e.message : ko.usAnnouncement.loadFail);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [kind, symbolFilter],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const onRefreshScan = async () => {
    setBusy(true);
    setError(null);
    setScanStatus(null);
    try {
      const tick = await tickUsAnnouncements({ notify: true });
      const inserted = Number(tick.inserted) || 0;
      const errN = Array.isArray(tick.errors) ? tick.errors.length : 0;

      // 스캔 후 전체 목록을 보여 필터 때문에 "안 늘어난 것처럼" 보이는 경우 방지
      setSymbolFilter("");
      setKind("");

      const res = await load({ symbol: "", kind: "" });
      const total = res?.cards?.length ?? 0;

      if (inserted > 0) {
        setScanStatus(
          ko.usAnnouncement.scanOkNew
            .replace("{n}", String(inserted))
            .replace("{total}", String(total)),
        );
      } else {
        setScanStatus(
          ko.usAnnouncement.scanOkNone.replace("{total}", String(total)),
        );
      }
      if (errN > 0) {
        setScanStatus(
          (prev) =>
            `${prev ?? ""} ${ko.usAnnouncement.scanPartialErrors.replace("{n}", String(errN))}`.trim(),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.usAnnouncement.scanFail);
      setScanStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const onAddWatch = async () => {
    const sym = watchInput.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    try {
      const res = await addUsAnnouncementWatch(sym);
      setWatchlist(res.watchlist);
      setWatchInput("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.usAnnouncement.watchFail);
    } finally {
      setBusy(false);
    }
  };

  const onSeedDemo = async () => {
    setBusy(true);
    try {
      await seedUsAnnouncement({
        symbol: "AAPL",
        kind: "guidance",
        title: "Demo · 가이던스 vs 컨센",
        metrics: {
          guidanceEps: 6.8,
          consensusEps: 7.2,
          trailingEps: 6.1,
        },
        notify: false,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : ko.usAnnouncement.seedFail);
    } finally {
      setBusy(false);
    }
  };

  const filteredHint = useMemo(() => {
    if (!cards.length) return ko.usAnnouncement.empty;
    return ko.usAnnouncement.count.replace("{n}", String(cards.length));
  }, [cards.length]);

  return (
    <div className="us-ann-inbox">
      <header className="us-ann-inbox__header">
        <div>
          <h2 className="us-ann-inbox__title">{ko.usAnnouncement.title}</h2>
          <p className="us-ann-inbox__sub">{ko.usAnnouncement.subtitle}</p>
        </div>
        <div className="us-ann-inbox__header-actions">
          <button
            type="button"
            className="us-ann-inbox__btn us-ann-inbox__btn--primary"
            disabled={busy}
            onClick={() => void onRefreshScan()}
          >
            {busy ? ko.usAnnouncement.scanning : ko.usAnnouncement.scanNow}
          </button>
          <button
            type="button"
            className="us-ann-inbox__btn"
            disabled={busy}
            onClick={() => void load()}
          >
            {ko.usAnnouncement.reload}
          </button>
        </div>
      </header>

      <section className="us-ann-inbox__watch" aria-label={ko.usAnnouncement.watchlist}>
        <div className="us-ann-inbox__watch-row">
          <span className="us-ann-inbox__watch-label">{ko.usAnnouncement.watchlist}</span>
          <div className="us-ann-inbox__chips">
            {watchlist.map((s) => (
              <button
                key={s}
                type="button"
                className={
                  symbolFilter.toUpperCase() === s
                    ? "us-ann-inbox__chip us-ann-inbox__chip--active"
                    : "us-ann-inbox__chip"
                }
                onClick={() =>
                  setSymbolFilter((prev) => (prev.toUpperCase() === s ? "" : s))
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="us-ann-inbox__watch-add">
          <input
            className="us-ann-inbox__input"
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value.toUpperCase())}
            placeholder={ko.usAnnouncement.watchPlaceholder}
            aria-label={ko.usAnnouncement.watchPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onAddWatch();
            }}
          />
          <button
            type="button"
            className="us-ann-inbox__btn"
            disabled={busy || !watchInput.trim()}
            onClick={() => void onAddWatch()}
          >
            {ko.usAnnouncement.watchAdd}
          </button>
          <button
            type="button"
            className="us-ann-inbox__btn us-ann-inbox__btn--ghost"
            disabled={busy}
            onClick={() => void onSeedDemo()}
          >
            {ko.usAnnouncement.seedDemo}
          </button>
        </div>
      </section>

      <div className="us-ann-inbox__filters" role="tablist" aria-label={ko.usAnnouncement.filters}>
        {KIND_FILTERS.map((f) => (
          <button
            key={f.id || "all"}
            type="button"
            role="tab"
            aria-selected={kind === f.id}
            className={
              kind === f.id
                ? "us-ann-inbox__filter us-ann-inbox__filter--active"
                : "us-ann-inbox__filter"
            }
            onClick={() => setKind(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="us-ann-inbox__meta">
        {filteredHint}
        {updatedAt ? ` · ${formatWhen(updatedAt)}` : null}
      </p>

      {scanStatus ? (
        <p className="us-ann-inbox__status" role="status">
          {scanStatus}
        </p>
      ) : null}

      {error ? (
        <p className="us-ann-inbox__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="us-ann-inbox__empty" role="status">
          {ko.usAnnouncement.loading}
        </p>
      ) : !cards.length ? (
        <p className="us-ann-inbox__empty" role="status">
          {ko.usAnnouncement.empty}
        </p>
      ) : (
        <ol className="us-ann-inbox__timeline">
          {cards.map((card) => (
            <li key={card.id} className="us-ann-inbox__card">
              <div className="us-ann-inbox__card-top">
                <span
                  className={`us-ann-inbox__badge us-ann-inbox__badge--${card.kind}`}
                >
                  {kindLabel(card.kind)}
                </span>
                <span className="us-ann-inbox__sym">{card.symbol}</span>
                <time
                  className="us-ann-inbox__time"
                  dateTime={new Date(card.filedAt).toISOString()}
                >
                  {formatWhen(card.filedAt)}
                </time>
              </div>
              <h3 className="us-ann-inbox__card-title">
                {card.headline || card.title}
              </h3>
              {card.headline && card.title && card.headline !== card.title ? (
                <p className="us-ann-inbox__card-sub">{card.title}</p>
              ) : null}

              <dl className="us-ann-inbox__metrics">
                <div>
                  <dt>{ko.usAnnouncement.vsConsensus}</dt>
                  <dd className={pctClass(card.metrics?.vsConsensusPct)}>
                    {formatPct(card.metrics?.vsConsensusPct)}
                  </dd>
                </div>
                <div>
                  <dt>{ko.usAnnouncement.yoy}</dt>
                  <dd className={pctClass(card.metrics?.yoyPct)}>
                    {formatPct(card.metrics?.yoyPct)}
                  </dd>
                </div>
                <div>
                  <dt>{ko.usAnnouncement.consensusChg}</dt>
                  <dd className={pctClass(card.metrics?.consensusChangePct)}>
                    {formatPct(card.metrics?.consensusChangePct)}
                  </dd>
                </div>
              </dl>

              {card.ai?.summary ? (
                <p className="us-ann-inbox__ai">
                  <span className="us-ann-inbox__ai-label">
                    {ko.usAnnouncement.aiLabel}
                  </span>
                  {card.ai.summary}
                </p>
              ) : null}

              {card.detail ? (
                <div className="us-ann-inbox__detail">
                  <span className="us-ann-inbox__detail-label">
                    {ko.usAnnouncement.detailLabel}
                  </span>
                  <p className="us-ann-inbox__detail-body">{card.detail}</p>
                </div>
              ) : null}

              <div className="us-ann-inbox__links">
                {card.links?.edgar ? (
                  <a
                    className="us-ann-inbox__link"
                    href={card.links.edgar}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    EDGAR
                  </a>
                ) : null}
                {card.links?.yahooAnalysis ? (
                  <a
                    className="us-ann-inbox__link"
                    href={card.links.yahooAnalysis}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Yahoo
                  </a>
                ) : null}
                <span className="us-ann-inbox__source">{card.source}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
