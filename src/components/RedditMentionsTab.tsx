import { useCallback, useEffect, useRef, useState } from "react";
import { type RedditMentionRow, type RedditMentionsPayload } from "../api";
import { ko } from "../i18n/ko";
import type { StockPick } from "../types";
import {
  getRedditMentionsMemory,
  prefetchRedditMentions,
} from "../lib/prefetchRedditMentions";
import TabShellFallback from "./TabShellFallback";
import "./reddit-mentions-tab.css";

type Props = {
  onOpenSymbol?: (pick: StockPick) => void;
};

function formatDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

export default function RedditMentionsTab({ onOpenSymbol }: Props) {
  const [filter, setFilter] = useState("all-stocks");
  const [payload, setPayload] = useState<RedditMentionsPayload | null>(() => {
    const mem = getRedditMentionsMemory();
    return mem?.filter === "all-stocks" ? mem.payload : null;
  });
  const [loading, setLoading] = useState(() => !getRedditMentionsMemory()?.payload);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async (nextFilter: string) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await prefetchRedditMentions(nextFilter);
      if (seq !== reqSeq.current) return;
      setPayload(data);
    } catch {
      if (seq !== reqSeq.current) return;
      setError(ko.app.redditMentionsError);
      setPayload((prev) => prev);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const openChart = (row: RedditMentionRow) => {
    onOpenSymbol?.({
      symbol: row.symbol,
      name: row.nameKo || row.name || row.symbol,
      market: "us",
      score: 0,
      signals: [],
    });
  };

  const rows = payload?.results ?? [];
  const filters = payload?.filters ?? [
    { id: "all-stocks", labelKo: "전체 주식 서브" },
    { id: "wallstreetbets", labelKo: "r/wallstreetbets" },
    { id: "stocks", labelKo: "r/stocks" },
    { id: "investing", labelKo: "r/investing" },
    { id: "options", labelKo: "r/options" },
  ];
  const showInitialLoading = loading && rows.length === 0;

  return (
    <div
      className="workspace reddit-mentions-tab"
      aria-label={ko.app.redditMentionsAria}
    >
      <header className="reddit-mentions-tab__head">
        <div>
          <h2 className="reddit-mentions-tab__title">
            {ko.app.redditMentionsTitle}
          </h2>
          <p className="reddit-mentions-tab__sub">
            {ko.app.redditMentionsSubtitle}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void load(filter)}
          disabled={loading && rows.length === 0}
        >
          {loading && rows.length > 0
            ? ko.app.redditMentionsRefreshing
            : ko.app.redditMentionsRefresh}
        </button>
      </header>

      <div className="reddit-mentions-tab__toolbar card">
        <span className="reddit-mentions-tab__filter-label">
          {ko.app.redditMentionsFilter}
        </span>
        <div className="reddit-mentions-tab__filters" role="group">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={
                filter === f.id
                  ? "reddit-mentions-tab__chip active"
                  : "reddit-mentions-tab__chip"
              }
              onClick={() => setFilter(f.id)}
              onMouseEnter={() => {
                void prefetchRedditMentions(f.id);
              }}
            >
              {f.labelKo}
            </button>
          ))}
        </div>
        <span className="reddit-mentions-tab__meta">
          {ko.app.redditMentionsCount.replace("{n}", String(rows.length))}
          {payload?.updatedAt
            ? ` · ${new Date(payload.updatedAt).toLocaleString("ko-KR")}`
            : null}
          {loading && rows.length > 0
            ? ` · ${ko.app.redditMentionsRefreshing}`
            : null}
        </span>
      </div>

      {payload?.sourceNote ? (
        <p className="reddit-mentions-tab__note">{payload.sourceNote}</p>
      ) : null}

      {showInitialLoading ? (
        <TabShellFallback variant="body" rows={10} />
      ) : error && rows.length === 0 ? (
        <p className="reddit-mentions-tab__empty" role="alert">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="reddit-mentions-tab__empty">
          {ko.app.redditMentionsEmpty}
        </p>
      ) : (
        <div
          className={
            loading
              ? "reddit-mentions-tab__table-wrap card is-refreshing"
              : "reddit-mentions-tab__table-wrap card"
          }
        >
          <table className="reddit-mentions-tab__table">
            <thead>
              <tr>
                <th>{ko.app.redditMentionsColRank}</th>
                <th>{ko.app.redditMentionsColSymbol}</th>
                <th>{ko.app.redditMentionsColNameKo}</th>
                <th>{ko.app.redditMentionsColName}</th>
                <th>{ko.app.redditMentionsColMentions}</th>
                <th>{ko.app.redditMentionsColDelta}</th>
                <th>{ko.app.redditMentionsColRankDelta}</th>
                <th>{ko.app.redditMentionsColUpvotes}</th>
                {onOpenSymbol ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const md = row.mentionsDelta;
                const rd = row.rankDelta;
                const mdClass = md > 0 ? "is-up" : md < 0 ? "is-down" : "";
                const rdClass =
                  rd != null && rd > 0
                    ? "is-up"
                    : rd != null && rd < 0
                      ? "is-down"
                      : "";
                return (
                  <tr
                    key={row.symbol}
                    className={
                      onOpenSymbol
                        ? "reddit-mentions-tab__row is-clickable"
                        : "reddit-mentions-tab__row"
                    }
                    onClick={
                      onOpenSymbol ? () => openChart(row) : undefined
                    }
                  >
                    <td className="reddit-mentions-tab__rank">{row.rank}</td>
                    <td className="reddit-mentions-tab__sym">{row.symbol}</td>
                    <td className="reddit-mentions-tab__name-ko">
                      {row.nameKo || "—"}
                    </td>
                    <td className="reddit-mentions-tab__name">{row.name}</td>
                    <td className="reddit-mentions-tab__num">
                      {row.mentions.toLocaleString("en-US")}
                    </td>
                    <td
                      className={`reddit-mentions-tab__num ${mdClass}`.trim()}
                    >
                      {formatDelta(md)}
                    </td>
                    <td
                      className={`reddit-mentions-tab__num ${rdClass}`.trim()}
                    >
                      {rd == null
                        ? "—"
                        : rd > 0
                          ? `▲${rd}`
                          : rd < 0
                            ? `▼${Math.abs(rd)}`
                            : "0"}
                    </td>
                    <td className="reddit-mentions-tab__num">
                      {row.upvotes.toLocaleString("en-US")}
                    </td>
                    {onOpenSymbol ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost reddit-mentions-tab__open"
                          onClick={(e) => {
                            e.stopPropagation();
                            openChart(row);
                          }}
                        >
                          {ko.app.redditMentionsOpenChart}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
