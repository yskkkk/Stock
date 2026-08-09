import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  addUsAnnouncementWatch,
  fetchUsAnnouncements,
  seedUsAnnouncement,
  tickUsAnnouncements,
  type UsAnnouncementCard,
  type UsAnnouncementKind,
} from "../api";
import { useMobileBackHandler } from "../hooks/useMobileBackHandler";
import { ko } from "../i18n/ko";
import { MOBILE_BACK_PRIORITY } from "../lib/mobileBackStack";
import "./us-announcement-inbox-tab.css";

/** 이 길이 이상(또는 deepAnalysis 존재)이면 모달 대신 인탭 페이지 */
const PAGE_VIEW_CHARS = 1_800;

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

/** 수치/해석 텍스트를 줄 단위로 (구 · / 줄바꿈 모두 지원) */
function splitBriefLines(text: string | null | undefined): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/\n+|(?:\s·\s)/)
    .map((s) => s.replace(/^수치 요약\s*[—–-]\s*/, "").trim())
    .filter(Boolean);
}

function splitAiParas(text: string | null | undefined): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (/\n/.test(raw)) {
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // 예전 한 줄 뭉치: "해석:" / "근거:" 앞에서 끊기
  return raw
    .split(/(?=(?:해석|근거)\s*[:：])|(?<=\.)\s+(?=[가-힣A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type AnalysisBlock = { heading?: string; paras: string[] };

/** 섹션 제목 → 스크롤용 id */
function sectionAnchorId(heading: string): string {
  const slug = String(heading)
    .trim()
    .replace(/[^\w가-힣·\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `us-ann-sec-${slug || "x"}`;
}

/** 목차 줄 "1. 한줄 요약" → 섹션 제목 */
function tocTargetHeading(line: string): string | null {
  const t = String(line ?? "").trim();
  if (!t) return null;
  const m = t.match(/^\d+[.)]\s*(.+)$/);
  return (m?.[1] ?? t).trim() || null;
}

function scrollToAnalysisSection(heading: string) {
  const el = document.getElementById(sectionAnchorId(heading));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** ## 섹션이 있으면 블록으로, 없으면 문단 리스트 */
function parseAnalysisBlocks(text: string | null | undefined): AnalysisBlock[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (!/^##\s/m.test(raw)) {
    return [{ paras: splitAiParas(raw) }];
  }
  return raw
    .split(/\n(?=##\s)/)
    .map((part) => {
      const lines = part.split("\n");
      const first = lines[0] ?? "";
      const m = first.match(/^##\s+(.+)$/);
      if (m) {
        return {
          heading: m[1].trim(),
          paras: splitAiParas(lines.slice(1).join("\n")),
        };
      }
      return { paras: splitAiParas(part) };
    })
    .filter((b) => b.heading || b.paras.length);
}

function cardBodyText(card: UsAnnouncementCard | null): string {
  if (!card) return "";
  return (
    card.deepAnalysis ||
    card.article ||
    card.detail ||
    card.ai?.summary ||
    ""
  );
}

function shouldUsePageView(card: UsAnnouncementCard | null): boolean {
  if (!card) return false;
  const body = cardBodyText(card);
  if (card.deepAnalysis && card.deepAnalysis.trim().length >= 400) return true;
  if (
    card.kind === "earnings" &&
    body.trim().length >= Math.floor(PAGE_VIEW_CHARS / 2)
  ) {
    return true;
  }
  return body.trim().length >= PAGE_VIEW_CHARS;
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
  const [selected, setSelected] = useState<UsAnnouncementCard | null>(null);

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
    const sym = symbolFilter.trim().toUpperCase();
    if (!sym) {
      setError(ko.usAnnouncement.scanNeedTicker);
      setScanStatus(null);
      return;
    }
    setBusy(true);
    setError(null);
    setScanStatus(ko.usAnnouncement.scanningTicker.replace("{sym}", sym));
    try {
      const tick = await tickUsAnnouncements({
        symbols: [sym],
        historyImport: true,
        historyDays: 180,
        filingLimit: 40,
        notify: false,
      });
      const inserted = Number(tick.inserted) || 0;
      const errN = Array.isArray(tick.errors) ? tick.errors.length : 0;

      const res = await load({ symbol: sym, kind: "" });
      setKind("");
      const total = res?.cards?.length ?? 0;
      const days = tick.historyDays ?? 180;

      if (inserted > 0) {
        setScanStatus(
          ko.usAnnouncement.scanOkTickerNew
            .replace("{sym}", sym)
            .replace("{n}", String(inserted))
            .replace("{days}", String(days))
            .replace("{total}", String(total)),
        );
      } else {
        setScanStatus(
          ko.usAnnouncement.scanOkTickerNone
            .replace("{sym}", sym)
            .replace("{days}", String(days))
            .replace("{total}", String(total)),
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

  const closeSelected = useCallback(() => setSelected(null), []);
  const pageMode = shouldUsePageView(selected);

  useMobileBackHandler(
    Boolean(selected && pageMode),
    MOBILE_BACK_PRIORITY.WORKSPACE_PICK,
    closeSelected,
  );

  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    if (!pageMode) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [selected, pageMode]);

  const analysisBlocks = useMemo(
    () => parseAnalysisBlocks(cardBodyText(selected)),
    [selected],
  );

  const filteredHint = useMemo(() => {
    if (!cards.length) return ko.usAnnouncement.empty;
    return ko.usAnnouncement.count.replace("{n}", String(cards.length));
  }, [cards.length]);

  const renderAnalysisBody = (classPrefix: "page" | "modal") => (
    <>
      <h3 className={`us-ann-inbox__${classPrefix}-section`}>
        {selected?.deepAnalysis
          ? ko.usAnnouncement.deepAnalysisLabel
          : ko.usAnnouncement.articleLabel}
      </h3>
      {analysisBlocks.length ? (
        analysisBlocks.map((block, i) => {
          const isToc = block.heading === "목차";
          return (
            <section
              key={`${block.heading ?? "p"}-${i}`}
              id={
                block.heading && !isToc
                  ? sectionAnchorId(block.heading)
                  : undefined
              }
              className={
                isToc
                  ? `us-ann-inbox__${classPrefix}-block us-ann-inbox__${classPrefix}-block--toc`
                  : `us-ann-inbox__${classPrefix}-block`
              }
            >
              {block.heading ? (
                <h4 className={`us-ann-inbox__${classPrefix}-h`}>
                  {block.heading}
                </h4>
              ) : null}
              {isToc
                ? block.paras.map((para) => {
                    const target = tocTargetHeading(para);
                    if (!target) return null;
                    return (
                      <button
                        key={para.slice(0, 64)}
                        type="button"
                        className={`us-ann-inbox__${classPrefix}-toc-link`}
                        onClick={() => scrollToAnalysisSection(target)}
                      >
                        {para}
                      </button>
                    );
                  })
                : block.paras.map((para) => (
                    <p
                      key={para.slice(0, 64)}
                      className={`us-ann-inbox__${classPrefix}-p`}
                    >
                      {para}
                    </p>
                  ))}
            </section>
          );
        })
      ) : (
        <p className={`us-ann-inbox__${classPrefix}-p`}>
          {ko.usAnnouncement.articleEmpty}
        </p>
      )}

      {selected?.numbersBrief ? (
        <>
          <h3 className={`us-ann-inbox__${classPrefix}-section`}>
            {ko.usAnnouncement.numbersLabel}
          </h3>
          <ul className="us-ann-inbox__numbers-list">
            {splitBriefLines(selected.numbersBrief).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );

  if (selected && pageMode) {
    return (
      <div className="us-ann-inbox us-ann-inbox--page">
        <article
          className="us-ann-inbox__page"
          aria-labelledby="us-ann-page-title"
        >
          <div className="us-ann-inbox__page-toolbar">
            <button
              type="button"
              className="us-ann-inbox__btn"
              onClick={closeSelected}
            >
              {ko.usAnnouncement.backToList}
            </button>
            <div className="us-ann-inbox__page-links">
              {selected.links?.edgar ? (
                <a
                  className="us-ann-inbox__link"
                  href={selected.links.edgar}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  EDGAR
                </a>
              ) : null}
              {selected.links?.yahooAnalysis ? (
                <a
                  className="us-ann-inbox__link"
                  href={selected.links.yahooAnalysis}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Yahoo
                </a>
              ) : null}
            </div>
          </div>
          <div className="us-ann-inbox__card-top">
            <span
              className={`us-ann-inbox__badge us-ann-inbox__badge--${selected.kind}`}
            >
              {kindLabel(selected.kind)}
            </span>
            <span className="us-ann-inbox__sym">{selected.symbol}</span>
            <time
              className="us-ann-inbox__time"
              dateTime={new Date(selected.filedAt).toISOString()}
            >
              {formatWhen(selected.filedAt)}
            </time>
          </div>
          <h2 id="us-ann-page-title" className="us-ann-inbox__page-title">
            {selected.headline || selected.title}
          </h2>
          {selected.form ? (
            <p className="us-ann-inbox__card-sub">{selected.form}</p>
          ) : null}
          {selected.about ? (
            <p className="us-ann-inbox__page-lead">{selected.about}</p>
          ) : null}
          <div className="us-ann-inbox__page-body">{renderAnalysisBody("page")}</div>
        </article>
      </div>
    );
  }

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
            disabled={busy || !symbolFilter.trim()}
            title={
              symbolFilter.trim()
                ? ko.usAnnouncement.scanTickerTitle.replace(
                    "{sym}",
                    symbolFilter.trim().toUpperCase(),
                  )
                : ko.usAnnouncement.scanNeedTicker
            }
            onClick={() => void onRefreshScan()}
          >
            {busy
              ? ko.usAnnouncement.scanning
              : symbolFilter.trim()
                ? ko.usAnnouncement.scanTicker.replace(
                    "{sym}",
                    symbolFilter.trim().toUpperCase(),
                  )
                : ko.usAnnouncement.scanPickTicker}
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

      <div className="us-ann-inbox__layout">
        <aside className="us-ann-inbox__side">
          <section
            className="us-ann-inbox__watch"
            aria-label={ko.usAnnouncement.watchlist}
          >
            <div className="us-ann-inbox__watch-row">
              <span className="us-ann-inbox__watch-label">
                {ko.usAnnouncement.watchlist}
              </span>
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
                      setSymbolFilter((prev) =>
                        prev.toUpperCase() === s ? "" : s,
                      )
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

          <div
            className="us-ann-inbox__filters"
            role="tablist"
            aria-label={ko.usAnnouncement.filters}
          >
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
        </aside>

        <div className="us-ann-inbox__main">
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
                <li
                  key={card.id}
                  className="us-ann-inbox__card us-ann-inbox__card--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(card)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(card);
                    }
                  }}
                  aria-label={ko.usAnnouncement.openArticle.replace(
                    "{title}",
                    card.headline || card.title,
                  )}
                >
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
                  {card.headline &&
                  card.title &&
                  card.headline !== card.title ? (
                    <p className="us-ann-inbox__card-sub">{card.title}</p>
                  ) : null}

                  {card.about ? (
                    <div className="us-ann-inbox__about">
                      <span className="us-ann-inbox__about-label">
                        {ko.usAnnouncement.aboutLabel}
                      </span>
                      <p className="us-ann-inbox__about-body">{card.about}</p>
                    </div>
                  ) : null}

                  <dl className="us-ann-inbox__metrics">
                    <div>
                      <dt>{ko.usAnnouncement.vsConsensus}</dt>
                      <dd className={pctClass(card.metrics?.vsConsensusPct)}>
                        {formatPct(card.metrics?.vsConsensusPct)}
                      </dd>
                      <p className="us-ann-inbox__metric-hint">
                        {card.metrics?.vsConsensusLabel ||
                          (card.metrics?.vsConsensusPct == null
                            ? card.kind === "governance"
                              ? ko.usAnnouncement.metricNaGovernance
                              : ko.usAnnouncement.metricNa
                            : "")}
                      </p>
                    </div>
                    <div>
                      <dt>{ko.usAnnouncement.yoy}</dt>
                      <dd className={pctClass(card.metrics?.yoyPct)}>
                        {formatPct(card.metrics?.yoyPct)}
                      </dd>
                      <p className="us-ann-inbox__metric-hint">
                        {card.metrics?.yoyLabel ||
                          (card.metrics?.yoyPct == null
                            ? card.kind === "governance"
                              ? ko.usAnnouncement.metricNaGovernance
                              : ko.usAnnouncement.metricNa
                            : "")}
                      </p>
                    </div>
                    <div>
                      <dt>{ko.usAnnouncement.consensusChg}</dt>
                      <dd className={pctClass(card.metrics?.consensusChangePct)}>
                        {formatPct(card.metrics?.consensusChangePct)}
                      </dd>
                      <p className="us-ann-inbox__metric-hint">
                        {card.metrics?.consensusChangeLabel ||
                          (card.metrics?.consensusChangePct == null
                            ? card.kind === "governance"
                              ? ko.usAnnouncement.metricNaGovernance
                              : ko.usAnnouncement.metricNa
                            : "")}
                      </p>
                    </div>
                  </dl>

                  {card.numbersBrief ? (
                    <div className="us-ann-inbox__numbers">
                      <span className="us-ann-inbox__numbers-label">
                        {ko.usAnnouncement.numbersLabel}
                      </span>
                      <ul className="us-ann-inbox__numbers-list">
                        {splitBriefLines(card.numbersBrief).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {card.ai?.summary ? (
                    <div className="us-ann-inbox__ai">
                      <span className="us-ann-inbox__ai-label">
                        {ko.usAnnouncement.aiLabel}
                      </span>
                      <div className="us-ann-inbox__ai-body">
                        {splitAiParas(card.ai.summary)
                          .slice(0, 2)
                          .map((para) => (
                            <p key={para.slice(0, 48)}>{para}</p>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  {card.deepAnalysis ? (
                    <p className="us-ann-inbox__deep-teaser">
                      {ko.usAnnouncement.deepTeaser}
                    </p>
                  ) : (
                    <p className="us-ann-inbox__open-hint">
                      {ko.usAnnouncement.openHint}
                    </p>
                  )}

                  <div
                    className="us-ann-inbox__links"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
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
      </div>

      {selected && !pageMode
        ? createPortal(
            <div
              className="us-ann-inbox__modal-backdrop"
              role="presentation"
              onClick={closeSelected}
            >
              <div
                className="us-ann-inbox__modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="us-ann-article-title"
                onClick={(e) => e.stopPropagation()}
              >
                <header className="us-ann-inbox__modal-header">
                  <div>
                    <div className="us-ann-inbox__card-top">
                      <span
                        className={`us-ann-inbox__badge us-ann-inbox__badge--${selected.kind}`}
                      >
                        {kindLabel(selected.kind)}
                      </span>
                      <span className="us-ann-inbox__sym">{selected.symbol}</span>
                      <time
                        className="us-ann-inbox__time"
                        dateTime={new Date(selected.filedAt).toISOString()}
                      >
                        {formatWhen(selected.filedAt)}
                      </time>
                    </div>
                    <h2
                      id="us-ann-article-title"
                      className="us-ann-inbox__modal-title"
                    >
                      {selected.headline || selected.title}
                    </h2>
                    {selected.form ? (
                      <p className="us-ann-inbox__card-sub">{selected.form}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="us-ann-inbox__btn"
                    onClick={closeSelected}
                  >
                    {ko.usAnnouncement.closeArticle}
                  </button>
                </header>

                <div className="us-ann-inbox__modal-body">
                  {renderAnalysisBody("modal")}
                </div>

                <footer className="us-ann-inbox__modal-footer">
                  {selected.links?.edgar ? (
                    <a
                      className="us-ann-inbox__link"
                      href={selected.links.edgar}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      EDGAR
                    </a>
                  ) : null}
                  {selected.links?.yahooAnalysis ? (
                    <a
                      className="us-ann-inbox__link"
                      href={selected.links.yahooAnalysis}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Yahoo
                    </a>
                  ) : null}
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
