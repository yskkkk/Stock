import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import {
  buildDonutSegments,
  donutArcPath,
  donutArcPathPopOut,
  fmtSectorPct,
  fmtSp500DateAdded,
  fmtSp500MarketCap,
  sp500DateSortMs,
  sp500MarketCapSortValue,
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

type SortKey = "symbol" | "name" | "sub" | "date-desc" | "date-asc" | "mktcap-desc";

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
    if (sortKey === "mktcap-desc") {
      const cmp =
        sp500MarketCapSortValue(b.marketCap) - sp500MarketCapSortValue(a.marketCap);
      return cmp !== 0 ? cmp : a.symbol.localeCompare(b.symbol, "en", { sensitivity: "base" });
    }
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
  const [query, setQuery] = useState("");
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);
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

  const focusSector = hoveredSector ?? selectedSector;

  const focusRow = useMemo(
    () =>
      focusSector && data
        ? data.sectors.find((s) => s.sector === focusSector) ?? null
        : null,
    [data, focusSector],
  );

  const sectorCompanies = useMemo(() => {
    if (!data || !selectedSector) return [];
    return sortCompanies(
      data.companies.filter((c) => c.sector === selectedSector),
      sortKey,
    );
  }, [data, selectedSector, sortKey]);

  const normalizedQuery = query.trim().toLowerCase();

  const matchesQuery = useCallback(
    (c: Sp500CompanyRow) => {
      if (!normalizedQuery) return true;
      const nameKo = companyKoName(c)?.toLowerCase() ?? "";
      return (
        c.symbol.toLowerCase().includes(normalizedQuery) ||
        c.name.toLowerCase().includes(normalizedQuery) ||
        nameKo.includes(normalizedQuery)
      );
    },
    [normalizedQuery],
  );

  // 검색어가 있으면 섹터 선택과 무관하게 전 종목에서 티커·한글명·영문명으로 필터.
  const visibleCompanies = useMemo(() => {
    if (!data) return [];
    if (normalizedQuery) {
      return sortCompanies(data.companies, sortKey).filter(matchesQuery);
    }
    if (selectedSector) return sectorCompanies;
    return sortCompanies(data.companies, sortKey).slice(0, 40);
  }, [data, normalizedQuery, sortKey, selectedSector, sectorCompanies, matchesQuery]);

  // 단일 섹터만 보고 있을 때만 섹터 컬럼 숨김(검색 중엔 여러 섹터가 섞이므로 표시)
  const showSectorCol = !selected || Boolean(normalizedQuery);

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
            {[...segments]
              .sort((a, b) => {
                const aLift = hoveredSector === a.sector ? 1 : 0;
                const bLift = hoveredSector === b.sector ? 1 : 0;
                return aLift - bLift;
              })
              .map((seg) => {
              const lifted = hoveredSector === seg.sector;
              const dimmed = focusSector && focusSector !== seg.sector;
              const segClass = [
                "sp500-wheel-mini__seg",
                lifted ? "sp500-wheel-mini__seg--lifted" : "",
                dimmed ? "sp500-wheel-mini__seg--dim" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <path
                  key={seg.sector}
                  className={segClass}
                  d={
                    lifted
                      ? donutArcPathPopOut(cx, cy, r0, r1, seg.a0, seg.a1)
                      : donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)
                  }
                  fill={seg.color}
                  onClick={() => openSectorDetail(seg.sector, "list")}
                  onMouseEnter={() => setHoveredSector(seg.sector)}
                  onMouseLeave={() => setHoveredSector(null)}
                />
              );
            })}
            <text
              className="sp500-wheel-mini__center-label"
              x={cx}
              y={cy - (focusRow ? 10 : 4)}
              textAnchor="middle"
            >
              {focusRow ? focusRow.sectorKo : "S&P 500"}
            </text>
            {focusRow ? (
              <text
                className="sp500-wheel-mini__center-en"
                x={cx}
                y={cy + 4}
                textAnchor="middle"
              >
                {focusRow.sector}
              </text>
            ) : null}
            <text
              className="sp500-wheel-mini__center-value"
              x={cx}
              y={cy + (focusRow ? 22 : 16)}
              textAnchor="middle"
            >
              {focusRow
                ? `${focusRow.count} · ${fmtSectorPct(focusRow.pct)}`
                : data.total}
            </text>
          </svg>

          <ul className="sp500-wheel-mini__legend">
            {data.sectors.map((s) => (
              <li key={s.sector}>
                <button
                  type="button"
                  className={
                    selectedSector === s.sector
                      ? "sp500-wheel-mini__legend-btn active"
                      : hoveredSector === s.sector
                        ? "sp500-wheel-mini__legend-btn sp500-wheel-mini__legend-btn--hovered"
                        : "sp500-wheel-mini__legend-btn"
                  }
                  onClick={() => openSectorDetail(s.sector, "list")}
                  onMouseEnter={() => setHoveredSector(s.sector)}
                  onMouseLeave={() => setHoveredSector(null)}
                  onFocus={() => setHoveredSector(s.sector)}
                  onBlur={() => setHoveredSector(null)}
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
          <div className="sp500-wheel-mini__search-row">
            <input
              type="search"
              className="sp500-wheel-mini__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ko.app.sp500SectorSearchPlaceholder}
              aria-label={ko.app.sp500SectorSearchAria}
            />
            {query ? (
              <button
                type="button"
                className="sp500-wheel-mini__search-clear"
                onClick={() => setQuery("")}
                aria-label={ko.app.sp500SectorSearchClear}
                title={ko.app.sp500SectorSearchClear}
              >
                ×
              </button>
            ) : null}
          </div>
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
              <option value="mktcap-desc">{ko.app.sp500SectorSortMktCap}</option>
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

          {normalizedQuery ? (
            <p className="sp500-wheel-mini__filter-note">
              {visibleCompanies.length > 0
                ? ko.app.sp500SectorSearchCount.replace(
                    "{n}",
                    String(visibleCompanies.length),
                  )
                : ko.app.sp500SectorSearchEmpty}
            </p>
          ) : selected ? (
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
                  {showSectorCol ? <th>{ko.app.sp500SectorColSector}</th> : null}
                  <th>{ko.app.sp500SectorColSub}</th>
                  <th>{ko.app.sp500SectorColMarketCap}</th>
                  <th>{ko.app.sp500SectorColDateAdded}</th>
                </tr>
              </thead>
              <tbody>
                {visibleCompanies.map((c) => {
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
                    {showSectorCol ? <td>{c.sectorKo}</td> : null}
                    <td className="sp500-wheel-mini__sub">{c.subIndustry}</td>
                    <td className="sp500-wheel-mini__mktcap">{fmtSp500MarketCap(c.marketCap)}</td>
                    <td className="sp500-wheel-mini__date">{fmtSp500DateAdded(c.dateAdded)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!normalizedQuery && !selected && data.companies.length > 40 ? (
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
