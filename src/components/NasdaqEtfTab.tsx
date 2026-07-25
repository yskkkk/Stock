import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { fetchNasdaqEtfs, type NasdaqEtfRow } from "../api";
import { ko } from "../i18n/ko";
import type { StockPick } from "../types";
import DockPanelCenterLoading from "./DockPanelCenterLoading";
import "./nasdaq-etf-tab.css";

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 2 : 4,
  });
}

function formatAum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString("en-US");
}

function formatChange(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** 목록용 한 줄 미리보기(말줄임은 CSS) */
function descPreview(text: string | null | undefined): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s;
}

type Props = {
  onOpenSymbol?: (pick: StockPick) => void;
};

export default function NasdaqEtfTab({ onOpenSymbol }: Props) {
  const [rows, setRows] = useState<NasdaqEtfRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedSym, setExpandedSym] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNasdaqEtfs({ refresh });
      setRows(Array.isArray(data.etfs) ? data.etfs : []);
      setUpdatedAt(data.updatedAt ?? Date.now());
      setExpandedSym(null);
    } catch {
      setError(ko.app.nasdaqEtfError);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.symbol,
        r.name,
        r.nameKo,
        r.description,
        r.categoryKo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  const openRow = (row: NasdaqEtfRow) => {
    onOpenSymbol?.({
      symbol: row.symbol,
      name: row.nameKo || row.name || row.symbol,
      market: "us",
      score: 0,
      signals: [],
      price: row.price ?? undefined,
      changePercent: row.changePercent ?? undefined,
      currency: "USD",
    });
  };

  const toggleDesc = (symbol: string) => {
    setExpandedSym((prev) => (prev === symbol ? null : symbol));
  };

  const colSpan = onOpenSymbol ? 8 : 7;

  return (
    <div
      className="workspace nasdaq-etf-tab"
      aria-label={ko.app.nasdaqEtfAria}
    >
      <header className="nasdaq-etf-tab__head">
        <div>
          <h2 className="nasdaq-etf-tab__title">{ko.app.nasdaqEtfTitle}</h2>
          <p className="nasdaq-etf-tab__sub">{ko.app.nasdaqEtfSubtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {ko.app.nasdaqEtfRefresh}
        </button>
      </header>

      <div className="nasdaq-etf-tab__toolbar card">
        <input
          type="search"
          className="nasdaq-etf-tab__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ko.app.nasdaqEtfSearch}
          aria-label={ko.app.nasdaqEtfSearch}
        />
        <span className="nasdaq-etf-tab__meta">
          {ko.app.nasdaqEtfCount.replace("{n}", String(filtered.length))}
          {updatedAt
            ? ` · ${new Date(updatedAt).toLocaleString("ko-KR")}`
            : null}
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <DockPanelCenterLoading label={ko.app.nasdaqEtfLoading} />
      ) : error && rows.length === 0 ? (
        <p className="nasdaq-etf-tab__empty" role="alert">
          {error}
        </p>
      ) : filtered.length === 0 ? (
        <p className="nasdaq-etf-tab__empty">{ko.app.nasdaqEtfEmpty}</p>
      ) : (
        <div className="nasdaq-etf-tab__table-wrap card">
          <table className="nasdaq-etf-tab__table">
            <thead>
              <tr>
                <th>{ko.app.nasdaqEtfColSymbol}</th>
                <th>{ko.app.nasdaqEtfColNameKo}</th>
                <th>{ko.app.nasdaqEtfColDesc}</th>
                <th>{ko.app.nasdaqEtfColCategory}</th>
                <th>{ko.app.nasdaqEtfColPrice}</th>
                <th>{ko.app.nasdaqEtfColChange}</th>
                <th>{ko.app.nasdaqEtfColAum}</th>
                {onOpenSymbol ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const ch = row.changePercent;
                const chClass =
                  ch == null || !Number.isFinite(ch)
                    ? ""
                    : ch > 0
                      ? "is-up"
                      : ch < 0
                        ? "is-down"
                        : "";
                const open = expandedSym === row.symbol;
                const preview = descPreview(row.description);
                const hasDesc = Boolean(preview);

                return (
                  <Fragment key={row.symbol}>
                    <tr
                      className={
                        open
                          ? "nasdaq-etf-tab__row nasdaq-etf-tab__row--open"
                          : "nasdaq-etf-tab__row"
                      }
                    >
                      <td className="nasdaq-etf-tab__sym">{row.symbol}</td>
                      <td className="nasdaq-etf-tab__identity">
                        <div className="nasdaq-etf-tab__name-ko">
                          {row.nameKo || "—"}
                        </div>
                        <div className="nasdaq-etf-tab__name" title={row.name}>
                          {row.name}
                        </div>
                      </td>
                      <td className="nasdaq-etf-tab__desc-cell">
                        {hasDesc ? (
                          <button
                            type="button"
                            className={
                              open
                                ? "nasdaq-etf-tab__desc-btn is-open"
                                : "nasdaq-etf-tab__desc-btn"
                            }
                            aria-expanded={open}
                            onClick={() => toggleDesc(row.symbol)}
                          >
                            <span className="nasdaq-etf-tab__desc-preview">
                              {preview}
                            </span>
                            <span className="nasdaq-etf-tab__desc-toggle">
                              {open
                                ? ko.app.nasdaqEtfDescLess
                                : ko.app.nasdaqEtfDescMore}
                            </span>
                          </button>
                        ) : (
                          <span className="nasdaq-etf-tab__desc-empty">—</span>
                        )}
                      </td>
                      <td className="nasdaq-etf-tab__cat">
                        {row.categoryKo || "—"}
                      </td>
                      <td className="nasdaq-etf-tab__num">
                        {formatUsd(row.price)}
                      </td>
                      <td className={`nasdaq-etf-tab__num ${chClass}`.trim()}>
                        {formatChange(row.changePercent)}
                      </td>
                      <td className="nasdaq-etf-tab__num">
                        {formatAum(row.netAssets)}
                      </td>
                      {onOpenSymbol ? (
                        <td>
                          <button
                            type="button"
                            className="btn btn--ghost nasdaq-etf-tab__open"
                            onClick={() => openRow(row)}
                          >
                            {ko.app.nasdaqEtfOpenChart}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    {open && hasDesc ? (
                      <tr className="nasdaq-etf-tab__detail-row">
                        <td colSpan={colSpan}>
                          <div className="nasdaq-etf-tab__detail">
                            <div className="nasdaq-etf-tab__detail-label">
                              {ko.app.nasdaqEtfColDesc}
                              {row.categoryKo ? (
                                <span className="nasdaq-etf-tab__detail-cat">
                                  {row.categoryKo}
                                </span>
                              ) : null}
                            </div>
                            <p className="nasdaq-etf-tab__detail-body">
                              {row.description}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
