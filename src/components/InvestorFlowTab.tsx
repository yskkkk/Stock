import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchKrInvestorFlow, fetchKrInvestorFlowHoldings } from "../api";
import { ko } from "../i18n/ko";
import "../investor-flow-tab.css";
import { formatPercent, formatPrice, formatTurnover } from "../lib/format";
import {
  anchorRectForBubble,
  pointerFromElementCenter,
  type BubblePointer,
} from "../lib/bubblePointerAnchor";
import {
  formatInvestorNetQty,
  investorChangePctClass,
  investorNetQtyClass,
} from "../lib/formatInvestorFlow";
import type {
  KrInvestorFlowHoldingsDetail,
  KrInvestorFlowIndustrySummary,
  KrInvestorFlowItem,
  KrInvestorFlowResponse,
} from "../types";
import InvestorFlowHoldBubble, {
  positionInvestorFlowHoldBubble,
  type InvestorFlowHoldBubbleState,
} from "./InvestorFlowHoldBubble";

type RankKey = "foreign" | "institution" | "individual";
type FlowDir = "buy" | "sell";
type ViewMode = "list" | "sector";
type ListSortColumn =
  | "name"
  | "industry"
  | "foreign"
  | "institution"
  | "individual"
  | "foreignHold"
  | "change"
  | "turnover"
  | "price";
type SummarySortColumn =
  | "industry"
  | "count"
  | "foreign"
  | "institution"
  | "individual";
type SortPhase = "desc" | "asc" | "none";
type SortState<C extends string> = { column: C | null; phase: SortPhase };

const POLL_MS = 60_000;

function qtyForKey(row: KrInvestorFlowItem, key: RankKey): number | null {
  if (key === "foreign") return row.foreignNetQty ?? null;
  if (key === "institution") return row.institutionNetQty ?? null;
  return row.individualNetQty ?? null;
}

function summaryQtyForKey(row: KrInvestorFlowIndustrySummary, key: RankKey): number {
  if (key === "foreign") return row.foreignNetQty;
  if (key === "institution") return row.institutionNetQty;
  return row.individualNetQty;
}

function rowIndustry(row: KrInvestorFlowItem): string {
  const s = String(row.industry ?? "").trim();
  return s || "기타";
}

function cycleSort<C extends string>(prev: SortState<C>, column: C): SortState<C> {
  if (prev.column !== column) return { column, phase: "desc" };
  if (prev.phase === "desc") return { column, phase: "asc" };
  if (prev.phase === "asc") return { column: null, phase: "none" };
  return { column, phase: "desc" };
}

function numCmp(a: number | null | undefined, b: number | null | undefined): number {
  const av = a != null && Number.isFinite(a) ? a : null;
  const bv = b != null && Number.isFinite(b) ? b : null;
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  return av - bv;
}

function compareFlowItem(a: KrInvestorFlowItem, b: KrInvestorFlowItem, col: ListSortColumn): number {
  switch (col) {
    case "name":
      return a.name.localeCompare(b.name, "ko") || a.symbol.localeCompare(b.symbol);
    case "industry":
      return rowIndustry(a).localeCompare(rowIndustry(b), "ko");
    case "foreign":
      return numCmp(a.foreignNetQty, b.foreignNetQty);
    case "institution":
      return numCmp(a.institutionNetQty, b.institutionNetQty);
    case "individual":
      return numCmp(a.individualNetQty, b.individualNetQty);
    case "foreignHold":
      return numCmp(a.foreignHoldRatio, b.foreignHoldRatio);
    case "change":
      return numCmp(a.changePercent, b.changePercent);
    case "turnover":
      return numCmp(a.tradingValue, b.tradingValue);
    case "price":
      return numCmp(a.closePrice, b.closePrice);
  }
}

function compareSummaryRow(
  a: KrInvestorFlowIndustrySummary,
  b: KrInvestorFlowIndustrySummary,
  col: SummarySortColumn,
): number {
  switch (col) {
    case "industry":
      return a.industry.localeCompare(b.industry, "ko");
    case "count":
      return a.count - b.count;
    case "foreign":
      return a.foreignNetQty - b.foreignNetQty;
    case "institution":
      return a.institutionNetQty - b.institutionNetQty;
    case "individual":
      return a.individualNetQty - b.individualNetQty;
  }
}

function sortFlowItems(
  items: KrInvestorFlowItem[],
  sort: SortState<ListSortColumn>,
  rankKey: RankKey,
  flowDir: FlowDir,
): KrInvestorFlowItem[] {
  const arr = [...items];
  if (sort.column && sort.phase !== "none") {
    const mul = sort.phase === "desc" ? -1 : 1;
    return arr.sort(
      (a, b) =>
        mul * compareFlowItem(a, b, sort.column!) || a.symbol.localeCompare(b.symbol),
    );
  }
  return arr.sort((a, b) => {
    const av = qtyForKey(a, rankKey) ?? (flowDir === "buy" ? -Infinity : Infinity);
    const bv = qtyForKey(b, rankKey) ?? (flowDir === "buy" ? -Infinity : Infinity);
    return flowDir === "buy" ? bv - av : av - bv;
  });
}

function sortSummaryRows(
  items: KrInvestorFlowIndustrySummary[],
  sort: SortState<SummarySortColumn>,
  rankKey: RankKey,
  flowDir: FlowDir,
): KrInvestorFlowIndustrySummary[] {
  const arr = [...items];
  if (sort.column && sort.phase !== "none") {
    const mul = sort.phase === "desc" ? -1 : 1;
    return arr.sort(
      (a, b) =>
        mul * compareSummaryRow(a, b, sort.column!) || a.industry.localeCompare(b.industry, "ko"),
    );
  }
  return arr.sort((a, b) => {
    const av = summaryQtyForKey(a, rankKey);
    const bv = summaryQtyForKey(b, rankKey);
    return flowDir === "buy" ? bv - av : av - bv;
  });
}

function SortFlowTh<C extends string>({
  column,
  label,
  sort,
  onCycle,
  align = "right",
  className,
}: {
  column: C;
  label: string;
  sort: SortState<C>;
  onCycle: (col: C) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.column === column && sort.phase !== "none";
  const ariaSort = active ? (sort.phase === "desc" ? "descending" : "ascending") : "none";
  const mark = active ? (sort.phase === "desc" ? "▼" : "▲") : "↕";
  const nextPhase: "desc" | "asc" | "none" =
    sort.column !== column || sort.phase === "none"
      ? "desc"
      : sort.phase === "desc"
        ? "asc"
        : "none";

  return (
    <th
      className={[
        "investor-flow-tab__sort-th",
        active ? "is-active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        className={`investor-flow-tab__sort-btn${align === "left" ? " investor-flow-tab__sort-btn--left" : ""}`}
        aria-label={ko.investorFlow.sortColCycle(label, nextPhase)}
        aria-pressed={active}
        onClick={() => onCycle(column)}
      >
        <span>{label}</span>
        <span
          className={`investor-flow-tab__sort-mark${active ? "" : " investor-flow-tab__sort-mark--idle"}`}
          aria-hidden
        >
          {mark}
        </span>
      </button>
    </th>
  );
}

function InvestorFlowTableHead({
  listSort,
  onCycleSort,
  showIndustry,
}: {
  listSort: SortState<ListSortColumn>;
  onCycleSort: (col: ListSortColumn) => void;
  showIndustry?: boolean;
}) {
  return (
    <tr>
      <th className="investor-flow-tab__col--rank">#</th>
      <SortFlowTh
        column="name"
        label={ko.investorFlow.colName}
        sort={listSort}
        onCycle={onCycleSort}
        align="left"
        className="investor-flow-tab__col--name"
      />
      {showIndustry ? (
        <SortFlowTh
          column="industry"
          label={ko.investorFlow.colIndustry}
          sort={listSort}
          onCycle={onCycleSort}
          align="left"
          className="investor-flow-tab__col--industry"
        />
      ) : null}
      <SortFlowTh
        column="foreign"
        label={ko.investorFlow.colForeign}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="institution"
        label={ko.investorFlow.colInstitution}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="individual"
        label={ko.investorFlow.colIndividual}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="foreignHold"
        label={ko.investorFlow.colForeignHold}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="change"
        label={ko.investorFlow.colChange}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="turnover"
        label={ko.investorFlow.colTurnover}
        sort={listSort}
        onCycle={onCycleSort}
      />
      <SortFlowTh
        column="price"
        label={ko.investorFlow.colPrice}
        sort={listSort}
        onCycle={onCycleSort}
      />
    </tr>
  );
}

export default function InvestorFlowTab() {
  const [data, setData] = useState<KrInvestorFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankKey, setRankKey] = useState<RankKey>("foreign");
  const [flowDir, setFlowDir] = useState<FlowDir>("buy");
  const [listSort, setListSort] = useState<SortState<ListSortColumn>>({
    column: "foreign",
    phase: "desc",
  });
  const [summarySort, setSummarySort] = useState<SortState<SummarySortColumn>>({
    column: "foreign",
    phase: "desc",
  });
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [holdBubble, setHoldBubble] = useState<InvestorFlowHoldBubbleState | null>(null);
  const [holdDetail, setHoldDetail] = useState<KrInvestorFlowHoldingsDetail | null>(null);
  const [holdLoading, setHoldLoading] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const holdFetchSeq = useRef(0);

  const cycleListSort = useCallback((col: ListSortColumn) => {
    setListSort((prev) => cycleSort(prev, col));
    if (col === "foreign" || col === "institution" || col === "individual") {
      setRankKey(col);
    }
  }, []);

  const cycleSummarySort = useCallback((col: SummarySortColumn) => {
    setSummarySort((prev) => cycleSort(prev, col));
    if (col === "foreign" || col === "institution" || col === "individual") {
      setRankKey(col);
    }
  }, []);

  const closeHoldBubble = useCallback(() => {
    setHoldBubble(null);
    setHoldDetail(null);
    setHoldLoading(false);
    setHoldError(null);
  }, []);

  const openHoldBubble = useCallback((
    anchor: HTMLElement,
    row: KrInvestorFlowItem,
    pointer?: BubblePointer | null,
  ) => {
    const anchorRect = anchorRectForBubble(anchor, pointer);
    setHoldBubble({
      symbol: row.symbol,
      name: row.name,
      anchorRect,
      ...positionInvestorFlowHoldBubble(anchorRect),
    });
    setHoldDetail(null);
    setHoldError(null);
    setHoldLoading(true);

    const seq = ++holdFetchSeq.current;
    void (async () => {
      try {
        const detail = await fetchKrInvestorFlowHoldings(row.symbol);
        if (seq !== holdFetchSeq.current) return;
        setHoldDetail(detail);
      } catch (e: unknown) {
        if (seq !== holdFetchSeq.current) return;
        setHoldError(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === holdFetchSeq.current) setHoldLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean; refresh?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchKrInvestorFlow({ refresh: opts?.refresh });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const sectorSummary = useMemo(() => {
    const base = data?.industrySummary ?? [];
    const sorted = sortSummaryRows(base, summarySort, rankKey, flowDir);
    return flowDir === "buy"
      ? sorted.filter((row) => summaryQtyForKey(row, rankKey) > 0)
      : sorted.filter((row) => summaryQtyForKey(row, rankKey) < 0);
  }, [data?.industrySummary, flowDir, rankKey, summarySort]);

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    let filtered = items;
    if (q) {
      filtered = filtered.filter((row) => {
        const sym = row.symbol.replace(/\.(KS|KQ)$/i, "").toLowerCase();
        return (
          row.name.toLowerCase().includes(q) ||
          sym.includes(q) ||
          row.symbol.toLowerCase().includes(q) ||
          rowIndustry(row).toLowerCase().includes(q)
        );
      });
    }
    if (industryFilter !== "all") {
      filtered = filtered.filter((row) => rowIndustry(row) === industryFilter);
    }
    filtered = filtered.filter((row) => {
      const v = qtyForKey(row, rankKey);
      if (v == null) return false;
      return flowDir === "buy" ? v > 0 : v < 0;
    });
    return sortFlowItems(filtered, listSort, rankKey, flowDir);
  }, [data?.items, flowDir, industryFilter, listSort, query, rankKey]);

  const groupedRows = useMemo(() => {
    const map = new Map<string, KrInvestorFlowItem[]>();
    for (const row of rows) {
      const ind = rowIndustry(row);
      const list = map.get(ind) ?? [];
      list.push(row);
      map.set(ind, list);
    }
    return [...map.entries()].sort((a, b) => {
      const sum = (items: KrInvestorFlowItem[]) =>
        items.reduce((acc, row) => acc + (qtyForKey(row, rankKey) ?? 0), 0);
      const av = sum(a[1]);
      const bv = sum(b[1]);
      return flowDir === "buy" ? bv - av : av - bv;
    });
  }, [flowDir, rankKey, rows]);

  const flowTabs: { id: FlowDir; label: string }[] = [
    { id: "buy", label: ko.investorFlow.flowBuy },
    { id: "sell", label: ko.investorFlow.flowSell },
  ];

  const renderRow = (row: KrInvestorFlowItem, idx: number) => (
    <tr
      key={row.symbol}
      className={
        holdBubble?.symbol === row.symbol
          ? "investor-flow-tab__row--clickable investor-flow-tab__row--on"
          : "investor-flow-tab__row--clickable"
      }
      tabIndex={0}
      role="button"
      aria-expanded={holdBubble?.symbol === row.symbol}
      onClick={(e) =>
        openHoldBubble(e.currentTarget, row, {
          clientX: e.clientX,
          clientY: e.clientY,
        })
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHoldBubble(e.currentTarget, row, pointerFromElementCenter(e.currentTarget));
        }
      }}
    >
      <td className="investor-flow-tab__col--rank">{idx + 1}</td>
      <td className="investor-flow-tab__col--name">
        <span className="investor-flow-tab__name">{row.name}</span>
        <span className="investor-flow-tab__sym">{row.symbol.replace(/\.(KS|KQ)$/i, "")}</span>
      </td>
      <td className="investor-flow-tab__col--industry">{rowIndustry(row)}</td>
      <td className={investorNetQtyClass(row.foreignNetQty)}>
        {formatInvestorNetQty(row.foreignNetQty)}
      </td>
      <td className={investorNetQtyClass(row.institutionNetQty)}>
        {formatInvestorNetQty(row.institutionNetQty)}
      </td>
      <td className={investorNetQtyClass(row.individualNetQty)}>
        {formatInvestorNetQty(row.individualNetQty)}
      </td>
      <td>
        {row.foreignHoldRatio != null ? `${row.foreignHoldRatio.toFixed(2)}%` : "—"}
      </td>
      <td className={investorChangePctClass(row.changePercent)}>
        {row.changePercent != null ? formatPercent(row.changePercent) : "—"}
      </td>
      <td>{row.tradingValue != null ? formatTurnover(row.tradingValue, "KRW") : "—"}</td>
      <td>{row.closePrice != null ? formatPrice(row.closePrice, "KRW") : "—"}</td>
    </tr>
  );

  const renderSectorRow = (row: KrInvestorFlowItem, idx: number) => (
    <tr
      key={row.symbol}
      className={
        holdBubble?.symbol === row.symbol
          ? "investor-flow-tab__row--clickable investor-flow-tab__row--on"
          : "investor-flow-tab__row--clickable"
      }
      tabIndex={0}
      role="button"
      aria-expanded={holdBubble?.symbol === row.symbol}
      onClick={(e) =>
        openHoldBubble(e.currentTarget, row, {
          clientX: e.clientX,
          clientY: e.clientY,
        })
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHoldBubble(e.currentTarget, row, pointerFromElementCenter(e.currentTarget));
        }
      }}
    >
      <td className="investor-flow-tab__col--rank">{idx + 1}</td>
      <td className="investor-flow-tab__col--name">
        <span className="investor-flow-tab__name">{row.name}</span>
        <span className="investor-flow-tab__sym">{row.symbol.replace(/\.(KS|KQ)$/i, "")}</span>
      </td>
      <td className={investorNetQtyClass(row.foreignNetQty)}>
        {formatInvestorNetQty(row.foreignNetQty)}
      </td>
      <td className={investorNetQtyClass(row.institutionNetQty)}>
        {formatInvestorNetQty(row.institutionNetQty)}
      </td>
      <td className={investorNetQtyClass(row.individualNetQty)}>
        {formatInvestorNetQty(row.individualNetQty)}
      </td>
      <td>
        {row.foreignHoldRatio != null ? `${row.foreignHoldRatio.toFixed(2)}%` : "—"}
      </td>
      <td className={investorChangePctClass(row.changePercent)}>
        {row.changePercent != null ? formatPercent(row.changePercent) : "—"}
      </td>
      <td>{row.tradingValue != null ? formatTurnover(row.tradingValue, "KRW") : "—"}</td>
      <td>{row.closePrice != null ? formatPrice(row.closePrice, "KRW") : "—"}</td>
    </tr>
  );

  return (
    <section className="workspace investor-flow-tab card" aria-label={ko.investorFlow.title}>
      <header className="investor-flow-tab__head">
        <div>
          <h2 className="investor-flow-tab__title">{ko.investorFlow.title}</h2>
          <p className="investor-flow-tab__sub">{ko.investorFlow.subtitle}</p>
          <p className="investor-flow-tab__meta">
            {ko.investorFlow.metaLine(
              data?.bizDate,
              data?.itemCount ?? 0,
              data?.scanned ?? 0,
            )}
          </p>
        </div>
        <div className="investor-flow-tab__tools">
          <input
            className="investor-flow-tab__search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ko.investorFlow.searchPlaceholder}
            aria-label={ko.investorFlow.searchPlaceholder}
          />
          <button
            type="button"
            className="investor-flow-tab__refresh"
            disabled={loading}
            onClick={() => void load({ refresh: true })}
          >
            {loading ? ko.investorFlow.loading : ko.investorFlow.refresh}
          </button>
        </div>
      </header>

      <div className="investor-flow-tab__flow-tabs market-tabs" role="tablist" aria-label={ko.investorFlow.flowTabsAria}>
        {flowTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={flowDir === tab.id}
            className={flowDir === tab.id ? "market-tab active" : "market-tab"}
            onClick={() => setFlowDir(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="investor-flow-tab__view-tabs market-tabs" role="tablist" aria-label={ko.investorFlow.viewTabsAria}>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "list"}
          className={viewMode === "list" ? "market-tab active" : "market-tab"}
          onClick={() => setViewMode("list")}
        >
          {ko.investorFlow.viewList}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "sector"}
          className={viewMode === "sector" ? "market-tab active" : "market-tab"}
          onClick={() => setViewMode("sector")}
        >
          {ko.investorFlow.viewSector}
        </button>
      </div>

      {sectorSummary.length > 0 ? (
        <section className="investor-flow-tab__sector-summary" aria-label={ko.investorFlow.sectorSummaryTitle}>
          <h3 className="investor-flow-tab__sector-summary-title">{ko.investorFlow.sectorSummaryTitle}</h3>
          <div className="investor-flow-tab__sector-summary-wrap">
            <table className="investor-flow-tab__sector-summary-table">
              <thead>
                <tr>
                  <SortFlowTh
                    column="industry"
                    label={ko.investorFlow.colIndustry}
                    sort={summarySort}
                    onCycle={cycleSummarySort}
                    align="left"
                  />
                  <SortFlowTh
                    column="count"
                    label={ko.investorFlow.colCount}
                    sort={summarySort}
                    onCycle={cycleSummarySort}
                  />
                  <SortFlowTh
                    column="foreign"
                    label={ko.investorFlow.colForeign}
                    sort={summarySort}
                    onCycle={cycleSummarySort}
                  />
                  <SortFlowTh
                    column="institution"
                    label={ko.investorFlow.colInstitution}
                    sort={summarySort}
                    onCycle={cycleSummarySort}
                  />
                  <SortFlowTh
                    column="individual"
                    label={ko.investorFlow.colIndividual}
                    sort={summarySort}
                    onCycle={cycleSummarySort}
                  />
                </tr>
              </thead>
              <tbody>
                {sectorSummary.map((row) => (
                  <tr
                    key={row.industry}
                    className={
                      industryFilter === row.industry
                        ? "investor-flow-tab__sector-row--on"
                        : ""
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="investor-flow-tab__sector-link"
                        onClick={() =>
                          setIndustryFilter((cur) =>
                            cur === row.industry ? "all" : row.industry,
                          )
                        }
                      >
                        {row.industry}
                      </button>
                    </td>
                    <td>{row.count}</td>
                    <td className={investorNetQtyClass(row.foreignNetQty)}>
                      {formatInvestorNetQty(row.foreignNetQty)}
                    </td>
                    <td className={investorNetQtyClass(row.institutionNetQty)}>
                      {formatInvestorNetQty(row.institutionNetQty)}
                    </td>
                    <td className={investorNetQtyClass(row.individualNetQty)}>
                      {formatInvestorNetQty(row.individualNetQty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="investor-flow-tab__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data?.items?.length ? (
        <p className="investor-flow-tab__muted">{ko.investorFlow.loading}</p>
      ) : rows.length === 0 ? (
        <p className="investor-flow-tab__muted">{ko.investorFlow.empty}</p>
      ) : viewMode === "sector" ? (
        <div className="investor-flow-tab__groups">
          {groupedRows.map(([industry, group]) => (
            <section key={industry} className="investor-flow-tab__group card">
              <header className="investor-flow-tab__group-head">
                <h3 className="investor-flow-tab__group-title">{industry}</h3>
                <span className="investor-flow-tab__group-meta">
                  {ko.investorFlow.groupCount(group.length)}
                </span>
              </header>
              <div className="investor-flow-tab__table-wrap">
                <table className="investor-flow-tab__table">
                  <thead>
                    <InvestorFlowTableHead
                      listSort={listSort}
                      onCycleSort={cycleListSort}
                    />
                  </thead>
                  <tbody>
                    {group.map((row, idx) => renderSectorRow(row, idx + 1))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="investor-flow-tab__table-wrap">
          <table className="investor-flow-tab__table">
            <thead>
              <InvestorFlowTableHead
                listSort={listSort}
                onCycleSort={cycleListSort}
                showIndustry
              />
            </thead>
            <tbody>
              {rows.map((row, idx) => renderRow(row, idx + 1))}
            </tbody>
          </table>
        </div>
      )}

      <InvestorFlowHoldBubble
        open={holdBubble}
        loading={holdLoading}
        error={holdError}
        detail={holdDetail}
        onClose={closeHoldBubble}
      />
    </section>
  );
}
