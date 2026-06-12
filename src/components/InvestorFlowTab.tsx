import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchKrInvestorFlow } from "../api";
import { ko } from "../i18n/ko";
import { formatPrice } from "../lib/format";
import {
  formatInvestorNetQty,
  investorNetQtyClass,
} from "../lib/formatInvestorFlow";
import type {
  KrInvestorFlowIndustrySummary,
  KrInvestorFlowItem,
  KrInvestorFlowResponse,
} from "../types";

type RankKey = "foreign" | "institution" | "individual";
type FlowDir = "buy" | "sell";
type ViewMode = "list" | "sector";

const POLL_MS = 60_000;

function fmtUpdated(ms: number | undefined): string {
  if (!ms) return "—";
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

export default function InvestorFlowTab() {
  const [data, setData] = useState<KrInvestorFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankKey, setRankKey] = useState<RankKey>("foreign");
  const [flowDir, setFlowDir] = useState<FlowDir>("buy");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [industryFilter, setIndustryFilter] = useState<string>("");
  const [query, setQuery] = useState("");

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

  const industryTabs = useMemo(() => {
    if (data?.industryTabs?.length) return data.industryTabs;
    const set = new Set<string>();
    for (const row of data?.items ?? []) {
      set.add(rowIndustry(row));
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [data?.industryTabs, data?.items]);

  const sectorSummary = useMemo(() => {
    const base = data?.industrySummary ?? [];
    const sorted = [...base].sort((a, b) => {
      const av = summaryQtyForKey(a, rankKey);
      const bv = summaryQtyForKey(b, rankKey);
      return flowDir === "buy" ? bv - av : av - bv;
    });
    return flowDir === "buy"
      ? sorted.filter((row) => summaryQtyForKey(row, rankKey) > 0)
      : sorted.filter((row) => summaryQtyForKey(row, rankKey) < 0);
  }, [data?.industrySummary, flowDir, rankKey]);

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
    if (industryFilter) {
      filtered = filtered.filter((row) => rowIndustry(row) === industryFilter);
    }
    filtered = filtered.filter((row) => {
      const v = qtyForKey(row, rankKey);
      if (v == null) return false;
      return flowDir === "buy" ? v > 0 : v < 0;
    });
    return [...filtered].sort((a, b) => {
      const av = qtyForKey(a, rankKey) ?? (flowDir === "buy" ? -Infinity : Infinity);
      const bv = qtyForKey(b, rankKey) ?? (flowDir === "buy" ? -Infinity : Infinity);
      return flowDir === "buy" ? bv - av : av - bv;
    });
  }, [data?.items, flowDir, industryFilter, query, rankKey]);

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

  const rankTabs: { id: RankKey; label: string }[] = [
    { id: "foreign", label: ko.investorFlow.rankForeign },
    { id: "institution", label: ko.investorFlow.rankInstitution },
    { id: "individual", label: ko.investorFlow.rankIndividual },
  ];

  const flowTabs: { id: FlowDir; label: string }[] = [
    { id: "buy", label: ko.investorFlow.flowBuy },
    { id: "sell", label: ko.investorFlow.flowSell },
  ];

  const renderRow = (row: KrInvestorFlowItem, idx: number) => (
    <tr key={row.symbol}>
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
      <td>{row.closePrice != null ? formatPrice(row.closePrice, "KRW") : "—"}</td>
    </tr>
  );

  return (
    <section className="workspace investor-flow-tab card" aria-label={ko.investorFlow.title}>
      <header className="investor-flow-tab__head">
        <div>
          <h2 className="investor-flow-tab__title">{ko.investorFlow.title}</h2>
          <p className="investor-flow-tab__meta">
            {ko.investorFlow.subtitle} · {ko.investorFlow.bizDate(data?.bizDate)} ·{" "}
            {ko.investorFlow.updatedAt(fmtUpdated(data?.updatedAtMs))} ·{" "}
            {ko.investorFlow.count(data?.itemCount ?? 0, data?.scanned ?? 0)}
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
            className="btn btn--ghost"
            disabled={loading}
            onClick={() => void load({ refresh: true })}
          >
            {loading ? ko.investorFlow.loading : ko.investorFlow.refresh}
          </button>
        </div>
      </header>

      <div className="investor-flow-tab__rank-tabs market-tabs" role="tablist" aria-label={ko.investorFlow.investorTabsAria}>
        {rankTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={rankKey === tab.id}
            className={rankKey === tab.id ? "market-tab active" : "market-tab"}
            onClick={() => setRankKey(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
        <span className="investor-flow-tab__flow-hint">{ko.investorFlow.flowHint}</span>
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

      {industryTabs.length > 0 ? (
        <div className="investor-flow-tab__industry-bar" role="group" aria-label={ko.investorFlow.industryFilterAria}>
          <button
            type="button"
            className={
              industryFilter === ""
                ? "investor-flow-tab__industry-chip investor-flow-tab__industry-chip--on"
                : "investor-flow-tab__industry-chip"
            }
            onClick={() => setIndustryFilter("")}
          >
            {ko.investorFlow.industryAll}
          </button>
          {industryTabs.map((name) => (
            <button
              key={name}
              type="button"
              className={
                industryFilter === name
                  ? "investor-flow-tab__industry-chip investor-flow-tab__industry-chip--on"
                  : "investor-flow-tab__industry-chip"
              }
              onClick={() => setIndustryFilter((cur) => (cur === name ? "" : name))}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      {sectorSummary.length > 0 ? (
        <section className="investor-flow-tab__sector-summary" aria-label={ko.investorFlow.sectorSummaryTitle}>
          <h3 className="investor-flow-tab__sector-summary-title">{ko.investorFlow.sectorSummaryTitle}</h3>
          <div className="investor-flow-tab__sector-summary-wrap">
            <table className="investor-flow-tab__sector-summary-table">
              <thead>
                <tr>
                  <th>{ko.investorFlow.colIndustry}</th>
                  <th>{ko.investorFlow.colCount}</th>
                  <th>{ko.investorFlow.colForeign}</th>
                  <th>{ko.investorFlow.colInstitution}</th>
                  <th>{ko.investorFlow.colIndividual}</th>
                </tr>
              </thead>
              <tbody>
                {sectorSummary.slice(0, 24).map((row) => (
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
                            cur === row.industry ? "" : row.industry,
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
                    <tr>
                      <th className="investor-flow-tab__col--rank">#</th>
                      <th className="investor-flow-tab__col--name">{ko.investorFlow.colName}</th>
                      <th
                        className={rankKey === "foreign" ? "is-active" : ""}
                        aria-sort={rankKey === "foreign" ? "descending" : "none"}
                      >
                        {ko.investorFlow.colForeign}
                      </th>
                      <th
                        className={rankKey === "institution" ? "is-active" : ""}
                        aria-sort={rankKey === "institution" ? "descending" : "none"}
                      >
                        {ko.investorFlow.colInstitution}
                      </th>
                      <th
                        className={rankKey === "individual" ? "is-active" : ""}
                        aria-sort={rankKey === "individual" ? "descending" : "none"}
                      >
                        {ko.investorFlow.colIndividual}
                      </th>
                      <th>{ko.investorFlow.colForeignHold}</th>
                      <th>{ko.investorFlow.colPrice}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map((row, idx) => renderRow(row, idx + 1))}
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
              <tr>
                <th className="investor-flow-tab__col--rank">#</th>
                <th className="investor-flow-tab__col--name">{ko.investorFlow.colName}</th>
                <th>{ko.investorFlow.colIndustry}</th>
                <th
                  className={rankKey === "foreign" ? "is-active" : ""}
                  aria-sort={rankKey === "foreign" ? "descending" : "none"}
                >
                  {ko.investorFlow.colForeign}
                </th>
                <th
                  className={rankKey === "institution" ? "is-active" : ""}
                  aria-sort={rankKey === "institution" ? "descending" : "none"}
                >
                  {ko.investorFlow.colInstitution}
                </th>
                <th
                  className={rankKey === "individual" ? "is-active" : ""}
                  aria-sort={rankKey === "individual" ? "descending" : "none"}
                >
                  {ko.investorFlow.colIndividual}
                </th>
                <th>{ko.investorFlow.colForeignHold}</th>
                <th>{ko.investorFlow.colPrice}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => renderRow(row, idx + 1))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
