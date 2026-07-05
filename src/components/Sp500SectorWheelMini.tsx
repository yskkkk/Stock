import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import {
  buildDonutSegments,
  donutArcPath,
  fmtSectorPct,
  fmtSp500DateAdded,
  sp500DateSortMs,
  type Sp500CompanyRow,
  type Sp500SectorsPayload,
} from "../lib/sp500SectorChart";
import { useIsMobilePhone } from "../hooks/useIsMobilePhone";
import { getMappedSymbolName } from "../lib/symbolDisplayName";
import { yahooStockSymbolToTradingView } from "../lib/tradingviewSymbols";
import {
  StockVaultRowBubblePortal,
  type StockVaultRowBubbleActions,
  type StockVaultRowBubbleTarget,
} from "./StockVaultRowBubble";

type SortKey = "symbol" | "name" | "sub" | "date-desc" | "date-asc";

function companyKoName(c: Sp500CompanyRow): string | null {
  const koName = c.nameKo?.trim() || getMappedSymbolName(c.symbol);
  return koName || null;
}

function companySortName(c: Sp500CompanyRow): string {
  return companyKoName(c) ?? c.name;
}

function bubbleTarget(c: Sp500CompanyRow): StockVaultRowBubbleTarget {
  const nameKo = companyKoName(c);
  return {
    symbol: c.symbol,
    name: nameKo ?? c.name,
    market: "us",
    industry: c.sectorKo,
    tvSymbol: yahooStockSymbolToTradingView(c.symbol, "us"),
  };
}

function sortCompanies(
  list: Sp500SectorsPayload["companies"],
  sortKey: SortKey,
) {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sortKey === "date-desc" || sortKey === "date-asc") {
      const cmp = sp500DateSortMs(a.dateAdded) - sp500DateSortMs(b.dateAdded);
      return sortKey === "date-desc" ? -cmp : cmp;
    }
    const va =
      sortKey === "name"
        ? companySortName(a)
        : sortKey === "sub"
          ? a.subIndustry
          : a.symbol;
    const vb =
      sortKey === "name"
        ? companySortName(b)
        : sortKey === "sub"
          ? b.subIndustry
          : b.symbol;
    return va.localeCompare(vb, "en", { sensitivity: "base" });
  });
  return copy;
}

function Sp500SectorWheelMiniInner({ embedded = false }: { embedded?: boolean }) {
  const {
    data,
    loading,
    error,
    selectedSector,
    setSelectedSector,
    panelTab,
    setPanelTab,
    openSectorDetail,
  } = useSp500Sector();
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const rowBubbleTipId = useId();
  const bubbleActionsRef = useRef<StockVaultRowBubbleActions | null>(null);
  const mobile = useIsMobilePhone();

  const segments = useMemo(
    () => (data ? buildDonutSegments(data.sectors, data.total) : []),
    [data],
  );

  const selected = useMemo(
    () =>
      selectedSector && data
        ? data.sectors.find((s) => s.sector === selectedSector) ?? null
        : null,
    [data, selectedSector],
  );

  const sectorCompanies = useMemo(() => {
    if (!data || !selectedSector) return [];
    return sortCompanies(
      data.companies.filter((c) => c.sector === selectedSector),
      sortKey,
    );
  }, [data, selectedSector, sortKey]);

  const pickSector = useCallback(
    (sector: string) => {
      setSelectedSector(sector);
      setPanelTab("list");
    },
    [setPanelTab, setSelectedSector],
  );

  const showRowBubble = useCallback(
    (el: HTMLElement, company: Sp500CompanyRow) => {
      bubbleActionsRef.current?.showTip(el, bubbleTarget(company));
    },
    [],
  );

  const hideRowBubble = useCallback(() => {
    bubbleActionsRef.current?.scheduleHideTip();
  }, []);

  if (loading) {
    return (
      <aside
        className={
          embedded ? "sp500-wheel-mini sp500-wheel-mini--embedded" : "sp500-wheel-mini card"
        }
        aria-busy="true"
      >
        <p className="sp500-wheel-mini__muted">{ko.app.sp500SectorLoading}</p>
      </aside>
    );
  }

  if (error || !data) {
    return (
      <aside
        className={
          embedded ? "sp500-wheel-mini sp500-wheel-mini--embedded" : "sp500-wheel-mini card"
        }
        role="alert"
      >
        <p className="sp500-wheel-mini__error">{ko.app.sp500SectorError}</p>
      </aside>
    );
  }

  const cx = 100;
  const cy = 100;
  const r0 = 52;
  const r1 = 88;

  return (
    <aside
      className={
        embedded ? "sp500-wheel-mini sp500-wheel-mini--embedded" : "sp500-wheel-mini card"
      }
      aria-label={ko.app.sp500SectorAria}
    >
      {!embedded ? (
        <div className="sp500-wheel-mini__head">
          <div>
            <h3 className="sp500-wheel-mini__title">{ko.app.sp500SectorTitle}</h3>
            <p className="sp500-wheel-mini__sub">
              {data.weightBasisLabel ?? ko.app.sp500SectorBasis} · {data.total}
              {ko.app.sp500SectorCompaniesUnit}
            </p>
          </div>
          <a
            className="sp500-wheel-mini__full-link"
            href="/sp500-sector-wheel.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {ko.app.sp500SectorOpenFull}
          </a>
        </div>
      ) : (
        <p className="sp500-wheel-mini__sub sp500-wheel-mini__sub--embedded">
          {data.weightBasisLabel ?? ko.app.sp500SectorBasis} · {data.total}
          {ko.app.sp500SectorCompaniesUnit}
        </p>
      )}

      <div className="sp500-wheel-mini__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={
            panelTab === "chart" ? "sp500-wheel-mini__tab active" : "sp500-wheel-mini__tab"
          }
          aria-selected={panelTab === "chart"}
          onClick={() => setPanelTab("chart")}
        >
          {ko.app.sp500SectorTabChart}
        </button>
        <button
          type="button"
          role="tab"
          className={
            panelTab === "list" ? "sp500-wheel-mini__tab active" : "sp500-wheel-mini__tab"
          }
          aria-selected={panelTab === "list"}
          onClick={() => setPanelTab("list")}
        >
          {ko.app.sp500SectorTabList}
        </button>
      </div>

      {panelTab === "chart" ? (
        <div className="sp500-wheel-mini__chart-panel">
          <svg
            className="sp500-wheel-mini__svg"
            viewBox="0 0 200 200"
            role="img"
            aria-hidden="true"
          >
            {segments.map((seg) => {
              const dimmed = selectedSector && selectedSector !== seg.sector;
              return (
                <path
                  key={seg.sector}
                  className={
                    dimmed
                      ? "sp500-wheel-mini__seg sp500-wheel-mini__seg--dim"
                      : "sp500-wheel-mini__seg"
                  }
                  d={donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)}
                  fill={seg.color}
                  onClick={() => openSectorDetail(seg.sector, "list")}
                />
              );
            })}
            <text
              className="sp500-wheel-mini__center-label"
              x={cx}
              y={cy - (selected ? 10 : 4)}
              textAnchor="middle"
            >
              {selected ? selected.sectorKo : "S&P 500"}
            </text>
            {selected ? (
              <text
                className="sp500-wheel-mini__center-en"
                x={cx}
                y={cy + 4}
                textAnchor="middle"
              >
                {selected.sector}
              </text>
            ) : null}
            <text
              className="sp500-wheel-mini__center-value"
              x={cx}
              y={cy + (selected ? 22 : 16)}
              textAnchor="middle"
            >
              {selected ? selected.count : data.total}
            </text>
            {selected ? (
              <text
                className="sp500-wheel-mini__center-sub"
                x={cx}
                y={cy + 36}
                textAnchor="middle"
              >
                {fmtSectorPct(selected.pct)}
              </text>
            ) : null}
          </svg>

          <ul className="sp500-wheel-mini__legend">
            {data.sectors.map((s) => (
              <li key={s.sector}>
                <button
                  type="button"
                  className={
                    selectedSector === s.sector
                      ? "sp500-wheel-mini__legend-btn active"
                      : "sp500-wheel-mini__legend-btn"
                  }
                  onClick={() => openSectorDetail(s.sector, "list")}
                >
                  <span
                    className="sp500-wheel-mini__swatch"
                    style={{
                      background: segments.find((x) => x.sector === s.sector)?.color,
                    }}
                  />
                  <span className="sp500-wheel-mini__legend-text">
                    <span className="sp500-wheel-mini__legend-label">{s.sectorKo}</span>
                    <span className="sp500-wheel-mini__legend-en">{s.sector}</span>
                  </span>
                  <span className="sp500-wheel-mini__legend-pct">{fmtSectorPct(s.pct)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="sp500-wheel-mini__list-panel">
          <div className="sp500-wheel-mini__list-toolbar">
            <label className="sp500-wheel-mini__sort-label" htmlFor="sp500-mini-sort">
              {ko.app.sp500SectorSort}
            </label>
            <select
              id="sp500-mini-sort"
              className="sp500-wheel-mini__sort"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="symbol">{ko.app.sp500SectorSortSymbol}</option>
              <option value="name">{ko.app.sp500SectorSortName}</option>
              <option value="sub">{ko.app.sp500SectorSortSub}</option>
              <option value="date-desc">{ko.app.sp500SectorSortDateDesc}</option>
              <option value="date-asc">{ko.app.sp500SectorSortDateAsc}</option>
            </select>
            {selected ? (
              <button
                type="button"
                className="sp500-wheel-mini__clear"
                onClick={() => setSelectedSector(null)}
              >
                {ko.app.sp500SectorClearFilter}
              </button>
            ) : null}
          </div>

          {selected ? (
            <p className="sp500-wheel-mini__filter-note">
              {selected.sectorKo} · {sectorCompanies.length}
              {ko.app.sp500SectorCompaniesUnit}
            </p>
          ) : (
            <p className="sp500-wheel-mini__filter-note">
              {ko.app.sp500SectorPickHint}
            </p>
          )}

          <div className="sp500-wheel-mini__table-wrap">
            <table className="sp500-wheel-mini__table">
              <thead>
                <tr>
                  <th>{ko.app.sp500SectorColSymbol}</th>
                  <th>{ko.app.sp500SectorColName}</th>
                  {!selected ? <th>{ko.app.sp500SectorColSector}</th> : null}
                  <th>{ko.app.sp500SectorColSub}</th>
                  <th>{ko.app.sp500SectorColDateAdded}</th>
                </tr>
              </thead>
              <tbody>
                {(selected
                  ? sectorCompanies
                  : sortCompanies(data.companies, sortKey).slice(0, 40)
                ).map((c) => {
                  const nameKo = companyKoName(c);
                  return (
                  <tr
                    key={c.symbol}
                    className="sp500-wheel-mini__row sp500-wheel-mini__row-hover-zone"
                    onMouseEnter={
                      mobile
                        ? undefined
                        : (e) =>
                            showRowBubble(
                              e.currentTarget,
                              c,
                            )
                    }
                    onMouseLeave={mobile ? undefined : hideRowBubble}
                    onClick={(e) => {
                      if (mobile) {
                        bubbleActionsRef.current?.toggleTip(
                          e.currentTarget,
                          bubbleTarget(c),
                        );
                        return;
                      }
                      pickSector(c.sector);
                    }}
                  >
                    <td className="sp500-wheel-mini__sym">{c.symbol}</td>
                    <td className="sp500-wheel-mini__name">
                      {nameKo ? (
                        <span className="sp500-wheel-mini__name-ko">{nameKo}</span>
                      ) : null}
                      <span className="sp500-wheel-mini__name-en">{c.name}</span>
                    </td>
                    {!selected ? <td>{c.sectorKo}</td> : null}
                    <td className="sp500-wheel-mini__sub">{c.subIndustry}</td>
                    <td className="sp500-wheel-mini__date">{fmtSp500DateAdded(c.dateAdded)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!selected && data.companies.length > 40 ? (
            <p className="sp500-wheel-mini__more">
              {ko.app.sp500SectorMore.replace("{n}", String(data.companies.length - 40))}
            </p>
          ) : null}
        </div>
      )}
      <StockVaultRowBubblePortal actionsRef={bubbleActionsRef} tipId={rowBubbleTipId} />
    </aside>
  );
}

const Sp500SectorWheelMini = memo(Sp500SectorWheelMiniInner);
export default Sp500SectorWheelMini;
