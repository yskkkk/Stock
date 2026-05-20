import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRecommendationsTracker } from "../api";
import { signalChipMeta } from "../constants/signalChips";
import type { SignalId } from "../constants/signals";
import {
  displayStockSymbol,
  formatPercent,
  formatPrice,
  formatUpdatedAt,
} from "../lib/format";
import {
  sortRecTrackerItems,
  type RecTrackerSortKey,
  type SortDir,
} from "../lib/sortRecTracker";
import { ko } from "../i18n/ko";
import type {
  Market,
  RecommendationTrackerItem,
  RecommendationsTrackerResponse,
  StockPick,
} from "../types";

type MarketFilter = "all" | Market;

function formatWinRate(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

function outcomeLabel(outcome: RecommendationTrackerItem["outcome"]): string {
  switch (outcome) {
    case "win":
      return ko.app.recTrackerWin;
    case "loss":
      return ko.app.recTrackerLoss;
    case "flat":
      return ko.app.recTrackerFlat;
    default:
      return ko.app.recTrackerUnknown;
  }
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "up" | "down" | "neutral";
}) {
  return (
    <div
      className={
        accent
          ? `rec-tracker-stat rec-tracker-stat--${accent}`
          : "rec-tracker-stat"
      }
    >
      <span className="rec-tracker-stat__label">{label}</span>
      <span className="rec-tracker-stat__value">{value}</span>
    </div>
  );
}

export default function RecommendationsTab({
  onOpenPick,
}: {
  onOpenPick: (pick: StockPick) => void;
}) {
  const [data, setData] = useState<RecommendationsTrackerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<MarketFilter>("all");
  const [signalFilter, setSignalFilter] = useState<SignalId | null>(null);
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<RecTrackerSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchRecommendationsTracker()
      .then(setData)
      .catch((e) => {
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const availableDates = useMemo(() => data?.dates ?? [], [data?.dates]);

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!items.length) return [];
    return items.filter((it) => {
      if (dateFilter !== "all" && it.date !== dateFilter) return false;
      if (market !== "all" && it.market !== market) return false;
      if (signalFilter && !it.signalIds.includes(signalFilter)) return false;
      if (scoreFilter != null && it.score !== scoreFilter) return false;
      return true;
    });
  }, [data?.items, dateFilter, market, signalFilter, scoreFilter]);

  const sortedItems = useMemo(
    () => sortRecTrackerItems(filteredItems, sortKey, sortDir),
    [filteredItems, sortKey, sortDir],
  );

  const onSortColumn = useCallback(
    (key: RecTrackerSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir(
        key === "date" || key === "score" || key === "change" ? "desc" : "asc",
      );
    },
    [sortKey],
  );

  const filteredSummary = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let flats = 0;
    let unknown = 0;
    for (const it of filteredItems) {
      if (it.outcome === "win") wins++;
      else if (it.outcome === "loss") losses++;
      else if (it.outcome === "flat") flats++;
      else unknown++;
    }
    const decided = wins + losses;
    return {
      total: filteredItems.length,
      wins,
      losses,
      flats,
      unknown,
      winRatePct: decided > 0 ? (wins / decided) * 100 : null,
    };
  }, [filteredItems]);

  const signalStats = useMemo(() => {
    const base = data?.signalStats ?? [];
    if (!base.length && !filteredItems.length) return [];
    if (
      market === "all" &&
      !signalFilter &&
      scoreFilter == null &&
      dateFilter === "all"
    ) {
      return base;
    }
    const fromFiltered = new Map<string, { wins: number; losses: number; total: number }>();
    for (const it of filteredItems) {
      const ids = it.signalIds.length ? it.signalIds : [];
      for (const id of ids) {
        const cur = fromFiltered.get(id) ?? { wins: 0, losses: 0, total: 0 };
        cur.total++;
        if (it.outcome === "win") cur.wins++;
        else if (it.outcome === "loss") cur.losses++;
        fromFiltered.set(id, cur);
      }
    }
    return [...fromFiltered.entries()]
      .map(([signalId, c]) => {
        const decided = c.wins + c.losses;
        return {
          signalId,
          ...c,
          flats: 0,
          unknown: c.total - decided,
          winRatePct: decided > 0 ? (c.wins / decided) * 100 : null,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [data?.signalStats, filteredItems, market, signalFilter, scoreFilter, dateFilter]);

  const scoreStats = useMemo(() => {
    const base = data?.scoreStats ?? [];
    if (market === "all" && !signalFilter && scoreFilter == null) return base;
    const fromFiltered = new Map<number, { wins: number; losses: number; total: number }>();
    for (const it of filteredItems) {
      if (it.score == null || !Number.isFinite(it.score)) continue;
      const cur = fromFiltered.get(it.score) ?? { wins: 0, losses: 0, total: 0 };
      cur.total++;
      if (it.outcome === "win") cur.wins++;
      else if (it.outcome === "loss") cur.losses++;
      fromFiltered.set(it.score, cur);
    }
    return [...fromFiltered.entries()]
      .map(([score, c]) => {
        const decided = c.wins + c.losses;
        return {
          score,
          ...c,
          flats: 0,
          unknown: c.total - decided,
          winRatePct: decided > 0 ? (c.wins / decided) * 100 : null,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [data?.scoreStats, filteredItems, market, signalFilter, scoreFilter, dateFilter]);

  return (
    <div className="workspace workspace--rec-tracker">
      <section className="picks-panel card rec-tracker-panel" aria-label={ko.app.recTrackerTitle}>
        <div className="panel-head">
          <div className="panel-head__filters">
            <div className="market-tabs">
              <button
                type="button"
                className={market === "all" ? "market-tab active" : "market-tab"}
                onClick={() => setMarket("all")}
              >
                {ko.app.recTrackerMarketAll}
                <span className="market-tab__count">{data?.items.length ?? 0}</span>
              </button>
              <button
                type="button"
                className={market === "kr" ? "market-tab active" : "market-tab"}
                onClick={() => setMarket("kr")}
              >
                {ko.app.marketKr}
                <span className="market-tab__count">
                  {data?.items.filter((i) => i.market === "kr").length ?? 0}
                </span>
              </button>
              <button
                type="button"
                className={market === "us" ? "market-tab active" : "market-tab"}
                onClick={() => setMarket("us")}
              >
                {ko.app.marketUs}
                <span className="market-tab__count">
                  {data?.items.filter((i) => i.market === "us").length ?? 0}
                </span>
              </button>
            </div>
          </div>
          <div className="panel-head__tail">
            {data?.updatedAtMs ? (
              <span className="rec-tracker-updated">{formatUpdatedAt(data.updatedAtMs)}</span>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={loading}
              onClick={load}
            >
              {ko.app.recTrackerRefresh}
            </button>
          </div>
        </div>

        <p className="rec-tracker-sub">{ko.app.recTrackerSub}</p>
        <p className="rec-tracker-note">{ko.app.recTrackerBackfillNote}</p>

        {availableDates.length > 0 && (
          <div className="rec-tracker-date-tabs market-tabs">
            <button
              type="button"
              className={dateFilter === "all" ? "market-tab active" : "market-tab"}
              onClick={() => setDateFilter("all")}
            >
              {ko.app.recTrackerDateAll}
            </button>
            {availableDates.map((d) => (
              <button
                key={d}
                type="button"
                className={dateFilter === d ? "market-tab active" : "market-tab"}
                onClick={() => setDateFilter(d)}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {loading && !data && (
          <p className="news-modal-status">{ko.app.recTrackerLoading}</p>
        )}
        {error && (
          <p className="news-modal-status news-modal-error" role="alert">
            {error}
          </p>
        )}

        {!loading && data && filteredItems.length === 0 && (
          <p className="picks-empty">{ko.app.recTrackerEmpty}</p>
        )}

        {!loading && data && filteredSummary.unknown > 0 && (
          <p className="rec-tracker-warn">{ko.app.recTrackerUnknownHint}</p>
        )}

        {data && filteredItems.length > 0 && (
          <>
            <div className="rec-tracker-summary">
              <SummaryCard
                label={ko.app.recTrackerWinRate}
                value={formatWinRate(filteredSummary.winRatePct)}
                accent={
                  filteredSummary.winRatePct == null
                    ? "neutral"
                    : filteredSummary.winRatePct >= 50
                      ? "up"
                      : "down"
                }
              />
              <SummaryCard
                label={ko.app.recTrackerWins}
                value={String(filteredSummary.wins)}
                accent="up"
              />
              <SummaryCard
                label={ko.app.recTrackerLosses}
                value={String(filteredSummary.losses)}
                accent="down"
              />
              <SummaryCard
                label={ko.app.recTrackerTotal}
                value={String(filteredSummary.total)}
              />
            </div>

            {scoreStats.length > 0 && (
              <div className="rec-tracker-signals rec-tracker-scores card">
                <div className="rec-tracker-signals__head">
                  <span className="filter-title">{ko.app.recTrackerByScore}</span>
                  {scoreFilter != null ? (
                    <button
                      type="button"
                      className="filter-clear"
                      onClick={() => setScoreFilter(null)}
                    >
                      {ko.app.recTrackerClearFilter}
                    </button>
                  ) : null}
                </div>
                <div className="rec-tracker-signals__chips">
                  {scoreStats.map((s) => (
                    <button
                      key={s.score}
                      type="button"
                      className={
                        scoreFilter === s.score
                          ? "rec-tracker-score-chip rec-tracker-score-chip--active"
                          : "rec-tracker-score-chip"
                      }
                      aria-pressed={scoreFilter === s.score}
                      onClick={() =>
                        setScoreFilter((prev) => (prev === s.score ? null : s.score))
                      }
                    >
                      <span className="rec-tracker-score-chip__pts">
                        {s.score}
                        {ko.app.recTrackerScoreUnit}
                      </span>
                      <span className="rec-tracker-score-chip__rate">
                        {formatWinRate(s.winRatePct)}
                      </span>
                      <span className="rec-tracker-signal-chip__n">
                        {s.wins}승/{s.losses}패
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {signalStats.length > 0 && (
              <div className="rec-tracker-signals card">
                <div className="rec-tracker-signals__head">
                  <span className="filter-title">{ko.app.recTrackerBySignal}</span>
                  {signalFilter ? (
                    <button
                      type="button"
                      className="filter-clear"
                      onClick={() => setSignalFilter(null)}
                    >
                      {ko.app.recTrackerClearFilter}
                    </button>
                  ) : null}
                </div>
                <div className="rec-tracker-signals__chips">
                  {signalStats.map((s) => {
                    const chip = signalChipMeta(s.signalId as SignalId);
                    const active = signalFilter === s.signalId;
                    return (
                      <button
                        key={s.signalId}
                        type="button"
                        className={
                          active
                            ? `${chip.className} rec-tracker-signal-chip rec-tracker-signal-chip--active`
                            : `${chip.className} rec-tracker-signal-chip`
                        }
                        title={chip.label}
                        aria-pressed={active}
                        onClick={() =>
                          setSignalFilter((prev) =>
                            prev === s.signalId ? null : (s.signalId as SignalId),
                          )
                        }
                      >
                        <span>{chip.short}</span>
                        <span className="rec-tracker-signal-chip__rate">
                          {formatWinRate(s.winRatePct)}
                        </span>
                        <span className="rec-tracker-signal-chip__n">
                          {s.wins}승/{s.losses}패
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rec-tracker-table-wrap">
              <table className="rec-tracker-table">
                <thead>
                  <tr>
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColDate}
                      column="date"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                    />
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColName}
                      column="name"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                    />
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColScore}
                      column="score"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                      align="center"
                    />
                    <th>{ko.app.recTrackerColSignals}</th>
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColEntry}
                      column="entry"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                      align="num"
                    />
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColCurrent}
                      column="current"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                      align="num"
                    />
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColChange}
                      column="change"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                      align="num"
                    />
                    <RecTrackerSortTh
                      label={ko.app.recTrackerColResult}
                      column="outcome"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={onSortColumn}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((it) => (
                    <RecTrackerRow key={it.id} item={it} onOpenPick={onOpenPick} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function RecTrackerSortTh({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  align,
}: {
  label: string;
  column: RecTrackerSortKey;
  sortKey: RecTrackerSortKey;
  sortDir: SortDir;
  onSort: (key: RecTrackerSortKey) => void;
  align?: "center" | "num";
}) {
  const active = sortKey === column;
  const thClass =
    align === "center"
      ? "rec-tracker-th rec-tracker-th--center"
      : align === "num"
        ? "rec-tracker-th rec-tracker-th--num"
        : "rec-tracker-th";

  return (
    <th className={thClass}>
      <button
        type="button"
        className={
          active ? "rec-tracker-th__btn rec-tracker-th__btn--active" : "rec-tracker-th__btn"
        }
        onClick={() => onSort(column)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <span>{label}</span>
        <span className="rec-tracker-th__icon" aria-hidden>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function RecTrackerRow({
  item,
  onOpenPick,
}: {
  item: RecommendationTrackerItem;
  onOpenPick: (pick: StockPick) => void;
}) {
  const sym = displayStockSymbol(item.symbol);
  const up = (item.changePct ?? 0) >= 0;

  return (
    <tr
      className="rec-tracker-row rec-tracker-row--clickable"
      tabIndex={0}
      role="button"
      aria-label={`${item.name} ${ko.app.recTrackerOpenChart}`}
      onClick={() =>
        onOpenPick({
          symbol: item.symbol,
          name: item.name,
          market: item.market,
          score: item.score ?? 0,
          signals: [],
          signalIds: item.signalIds,
          price: item.currentPrice ?? item.entryPrice ?? undefined,
          currency: item.currency,
        })
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenPick({
            symbol: item.symbol,
            name: item.name,
            market: item.market,
            score: item.score ?? 0,
            signals: [],
            signalIds: item.signalIds,
            price: item.currentPrice ?? item.entryPrice ?? undefined,
            currency: item.currency,
          });
        }
      }}
    >
      <td className="rec-tracker-table__date">{item.date}</td>
      <td className="rec-tracker-table__name">
        <span className="rec-tracker-table__sym">{sym}</span>
        <span className="rec-tracker-table__nm">{item.name}</span>
      </td>
      <td className="rec-tracker-table__score">
        {item.score != null ? (
          <span className="rec-tracker-table__score-val">
            {item.score}
            {ko.app.recTrackerScoreUnit}
          </span>
        ) : (
          <span className="rec-tracker-table__muted">—</span>
        )}
      </td>
      <td className="rec-tracker-table__signals">
        {item.signalIds.length ? (
          <div className="rec-tracker-table__signal-tags">
            {item.signalIds.map((id) => {
              const chip = signalChipMeta(id as SignalId);
              return (
                <span key={id} className={chip.className} title={chip.label}>
                  {chip.short}
                </span>
              );
            })}
          </div>
        ) : (
          <span className="rec-tracker-table__muted">{ko.app.recTrackerNoSignals}</span>
        )}
      </td>
      <td className="rec-tracker-table__num">
        {formatPrice(item.entryPrice ?? undefined, item.currency)}
      </td>
      <td className="rec-tracker-table__num">
        {formatPrice(item.currentPrice ?? undefined, item.currency)}
      </td>
      <td
        className={
          item.changePct == null
            ? "rec-tracker-table__num"
            : up
              ? "rec-tracker-table__num rec-tracker-table__num--up"
              : "rec-tracker-table__num rec-tracker-table__num--down"
        }
      >
        {item.changePct == null ? "—" : formatPercent(item.changePct)}
      </td>
      <td>
        <span
          className={
            item.outcome === "win"
              ? "rec-tracker-badge rec-tracker-badge--win"
              : item.outcome === "loss"
                ? "rec-tracker-badge rec-tracker-badge--loss"
                : "rec-tracker-badge"
          }
        >
          {outcomeLabel(item.outcome)}
        </span>
      </td>
    </tr>
  );
}
