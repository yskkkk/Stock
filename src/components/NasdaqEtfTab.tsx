import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  Fragment,
  type MouseEvent,
} from "react";
import {
  fetchNasdaqEtfHoldings,
  fetchNasdaqEtfs,
  type NasdaqEtfHoldingsPayload,
  type NasdaqEtfRow,
} from "../api";
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

function formatWeight(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(2)}%`;
}

function descPreview(text: string | null | undefined): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s;
}

type Props = {
  onOpenSymbol?: (pick: StockPick) => void;
};

export default function NasdaqEtfTab({ onOpenSymbol }: Props) {
  const [rows, setRows] = useState<NasdaqEtfRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedSym, setExpandedSym] = useState<string | null>(null);
  const [selected, setSelected] = useState<NasdaqEtfRow | null>(null);
  const [holdings, setHoldings] = useState<NasdaqEtfHoldingsPayload | null>(
    null,
  );
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const rowsLenRef = useRef(0);
  rowsLenRef.current = rows.length;

  const load = useCallback(async (refresh = false) => {
    const hadRows = rowsLenRef.current > 0;
    if (!hadRows) setLoading(true);
    setError(null);
    try {
      const data = await fetchNasdaqEtfs({ refresh });
      setRows(Array.isArray(data.etfs) ? data.etfs : []);
      setUpdatedAt(data.updatedAt ?? Date.now());
      setBuilding(Boolean(data.building));
      setEnriching(Boolean(data.enriching));
      if (refresh) setExpandedSym(null);
    } catch {
      setError(ko.app.nasdaqEtfError);
      if (!hadRows) setRows([]);
      setBuilding(false);
      setEnriching(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!building && !enriching) return;
    const ms = building ? 700 : 1800;
    const id = window.setTimeout(() => {
      void load(false);
    }, ms);
    return () => window.clearTimeout(id);
  }, [building, enriching, load]);

  useEffect(() => {
    if (!selected) {
      setHoldings(null);
      setHoldingsError(null);
      return;
    }
    let cancelled = false;
    setHoldingsLoading(true);
    setHoldingsError(null);
    void fetchNasdaqEtfHoldings(selected.symbol)
      .then((data) => {
        if (!cancelled) setHoldings(data);
      })
      .catch(() => {
        if (!cancelled) {
          setHoldings(null);
          setHoldingsError(ko.app.nasdaqEtfHoldingsError);
        }
      })
      .finally(() => {
        if (!cancelled) setHoldingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [r.symbol, r.name, r.nameKo, r.description, r.categoryKo]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query]);

  const openChart = (row: Pick<NasdaqEtfRow, "symbol" | "name" | "nameKo" | "price" | "changePercent">) => {
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

  const openHoldingChart = (h: {
    symbol: string;
    name: string;
    nameKo: string | null;
  }) => {
    onOpenSymbol?.({
      symbol: h.symbol,
      name: h.nameKo || h.name || h.symbol,
      market: "us",
      score: 0,
      signals: [],
    });
  };

  const toggleDesc = (symbol: string, e: MouseEvent) => {
    e.stopPropagation();
    setExpandedSym((prev) => (prev === symbol ? null : symbol));
  };

  const colSpan = 8;

  if (selected) {
    const alloc = holdings?.allocation;
    const allocRows = alloc
      ? (
          [
            ["stock", ko.app.nasdaqEtfAllocStock, alloc.stock],
            ["bond", ko.app.nasdaqEtfAllocBond, alloc.bond],
            ["cash", ko.app.nasdaqEtfAllocCash, alloc.cash],
            ["other", ko.app.nasdaqEtfAllocOther, alloc.other],
          ] as const
        ).filter(([, , w]) => w != null && w > 0)
      : [];

    return (
      <div
        className="workspace nasdaq-etf-tab nasdaq-etf-tab--detail"
        aria-label={ko.app.nasdaqEtfHoldingsTitle}
      >
        <header className="nasdaq-etf-tab__head">
          <div>
            <button
              type="button"
              className="btn btn--ghost nasdaq-etf-tab__back"
              onClick={() => setSelected(null)}
            >
              ← {ko.app.nasdaqEtfHoldingsBack}
            </button>
            <h2 className="nasdaq-etf-tab__title">
              {selected.symbol}
              <span className="nasdaq-etf-tab__title-sub">
                {selected.nameKo || selected.name}
              </span>
            </h2>
            <p className="nasdaq-etf-tab__sub">
              {ko.app.nasdaqEtfHoldingsTitle}
              {selected.categoryKo ? ` · ${selected.categoryKo}` : ""}
              {holdings?.family ? ` · ${holdings.family}` : ""}
            </p>
          </div>
          <div className="nasdaq-etf-tab__head-actions">
            {onOpenSymbol ? (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => openChart(selected)}
              >
                {ko.app.nasdaqEtfOpenChart}
              </button>
            ) : null}
          </div>
        </header>

        {(selected.description || holdings?.description) ? (
          <div className="nasdaq-etf-tab__detail card nasdaq-etf-tab__detail--standalone">
            <div className="nasdaq-etf-tab__detail-label">
              {ko.app.nasdaqEtfColDesc}
            </div>
            <p className="nasdaq-etf-tab__detail-body">
              {selected.description || holdings?.description}
            </p>
          </div>
        ) : null}

        {holdingsLoading ? (
          <DockPanelCenterLoading label={ko.app.nasdaqEtfHoldingsLoading} />
        ) : holdingsError ? (
          <p className="nasdaq-etf-tab__empty" role="alert">
            {holdingsError}
          </p>
        ) : holdings ? (
          <>
            {holdings.note ? (
              <p className="nasdaq-etf-tab__note">{holdings.note}</p>
            ) : null}

            <div className="nasdaq-etf-tab__panels">
              {allocRows.length > 0 ? (
                <section className="card nasdaq-etf-tab__panel">
                  <h3 className="nasdaq-etf-tab__panel-title">
                    {ko.app.nasdaqEtfHoldingsAllocation}
                  </h3>
                  <ul className="nasdaq-etf-tab__bars">
                    {allocRows.map(([key, label, weight]) => (
                      <li key={key}>
                        <div className="nasdaq-etf-tab__bar-meta">
                          <span>{label}</span>
                          <span>{formatWeight(weight)}</span>
                        </div>
                        <div className="nasdaq-etf-tab__bar-track">
                          <div
                            className="nasdaq-etf-tab__bar-fill"
                            style={{
                              width: `${Math.min(100, (weight ?? 0) * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {holdings.sectors.length > 0 ? (
                <section className="card nasdaq-etf-tab__panel">
                  <h3 className="nasdaq-etf-tab__panel-title">
                    {ko.app.nasdaqEtfHoldingsSectors}
                  </h3>
                  <ul className="nasdaq-etf-tab__bars">
                    {holdings.sectors.map((s) => (
                      <li key={s.key}>
                        <div className="nasdaq-etf-tab__bar-meta">
                          <span>{s.label}</span>
                          <span>{formatWeight(s.weight)}</span>
                        </div>
                        <div className="nasdaq-etf-tab__bar-track">
                          <div
                            className="nasdaq-etf-tab__bar-fill nasdaq-etf-tab__bar-fill--sector"
                            style={{
                              width: `${Math.min(100, s.weight * 100)}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <div className="nasdaq-etf-tab__table-wrap card">
              {holdings.holdings.length === 0 ? (
                <p className="nasdaq-etf-tab__empty">
                  {ko.app.nasdaqEtfHoldingsEmpty}
                </p>
              ) : (
                <>
                  <div className="nasdaq-etf-tab__weight-summary">
                    <div className="nasdaq-etf-tab__weight-summary-text">
                      <strong>
                        {ko.app.nasdaqEtfHoldingsSumShown.replace(
                          "{n}",
                          String(holdings.holdings.length),
                        )}
                      </strong>
                      <span>{formatWeight(holdings.holdingsWeightSum ?? 0)}</span>
                      <span className="nasdaq-etf-tab__weight-sep" aria-hidden>
                        ·
                      </span>
                      <strong>{ko.app.nasdaqEtfHoldingsOther}</strong>
                      <span>
                        {formatWeight(
                          holdings.holdingsOtherWeight ??
                            Math.max(
                              0,
                              1 - (holdings.holdingsWeightSum ?? 0),
                            ),
                        )}
                      </span>
                    </div>
                    <div className="nasdaq-etf-tab__weight-stack" aria-hidden>
                      <div
                        className="nasdaq-etf-tab__weight-stack-shown"
                        style={{
                          width: `${Math.min(
                            100,
                            (holdings.holdingsWeightSum ?? 0) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="nasdaq-etf-tab__weight-hint">
                      {ko.app.nasdaqEtfHoldingsTopOnly}
                    </p>
                  </div>
                  <table className="nasdaq-etf-tab__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>{ko.app.nasdaqEtfHoldingsColSymbol}</th>
                        <th>{ko.app.nasdaqEtfHoldingsColName}</th>
                        <th>{ko.app.nasdaqEtfHoldingsColWeight}</th>
                        {onOpenSymbol ? <th /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.holdings.map((h, i) => (
                        <tr key={h.symbol}>
                          <td className="nasdaq-etf-tab__num">{i + 1}</td>
                          <td className="nasdaq-etf-tab__sym">{h.symbol}</td>
                          <td className="nasdaq-etf-tab__identity">
                            <div className="nasdaq-etf-tab__name-ko">
                              {h.nameKo || h.name}
                            </div>
                            {h.nameKo ? (
                              <div className="nasdaq-etf-tab__name">{h.name}</div>
                            ) : null}
                          </td>
                          <td className="nasdaq-etf-tab__num">
                            {formatWeight(h.weight)}
                          </td>
                          {onOpenSymbol ? (
                            <td>
                              <button
                                type="button"
                                className="btn btn--ghost nasdaq-etf-tab__open"
                                onClick={() => openHoldingChart(h)}
                              >
                                {ko.app.nasdaqEtfOpenChart}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="nasdaq-etf-tab__tfoot">
                        <td colSpan={3}>
                          {ko.app.nasdaqEtfHoldingsSumShown.replace(
                            "{n}",
                            String(holdings.holdings.length),
                          )}
                        </td>
                        <td className="nasdaq-etf-tab__num">
                          {formatWeight(holdings.holdingsWeightSum ?? 0)}
                        </td>
                        {onOpenSymbol ? <td /> : null}
                      </tr>
                      <tr className="nasdaq-etf-tab__tfoot nasdaq-etf-tab__tfoot--other">
                        <td colSpan={3}>{ko.app.nasdaqEtfHoldingsOther}</td>
                        <td className="nasdaq-etf-tab__num">
                          {formatWeight(
                            holdings.holdingsOtherWeight ??
                              Math.max(
                                0,
                                1 - (holdings.holdingsWeightSum ?? 0),
                              ),
                          )}
                        </td>
                        {onOpenSymbol ? <td /> : null}
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          </>
        ) : null}
      </div>
    );
  }

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
          disabled={loading && rows.length === 0}
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
          {building
            ? ` · ${ko.app.nasdaqEtfBuilding}`
            : enriching
              ? ` · ${ko.app.nasdaqEtfEnriching}`
              : null}
        </span>
      </div>

      {loading && rows.length === 0 ? (
        <DockPanelCenterLoading label={ko.app.nasdaqEtfLoading} />
      ) : error && rows.length === 0 ? (
        <p className="nasdaq-etf-tab__empty" role="alert">
          {error}
        </p>
      ) : filtered.length === 0 && !building ? (
        <p className="nasdaq-etf-tab__empty">{ko.app.nasdaqEtfEmpty}</p>
      ) : filtered.length === 0 && building ? (
        <DockPanelCenterLoading label={ko.app.nasdaqEtfBuilding} />
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
                <th />
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
                          ? "nasdaq-etf-tab__row nasdaq-etf-tab__row--open nasdaq-etf-tab__row--clickable"
                          : "nasdaq-etf-tab__row nasdaq-etf-tab__row--clickable"
                      }
                      onClick={() => setSelected(row)}
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
                            onClick={(e) => toggleDesc(row.symbol, e)}
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
                      <td className="nasdaq-etf-tab__actions">
                        <button
                          type="button"
                          className="btn btn--ghost nasdaq-etf-tab__open"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(row);
                          }}
                        >
                          {ko.app.nasdaqEtfOpenHoldings}
                        </button>
                        {onOpenSymbol ? (
                          <button
                            type="button"
                            className="btn btn--ghost nasdaq-etf-tab__open"
                            onClick={(e) => {
                              e.stopPropagation();
                              openChart(row);
                            }}
                          >
                            {ko.app.nasdaqEtfOpenChart}
                          </button>
                        ) : null}
                      </td>
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
