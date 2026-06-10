import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchKrInvestorFlow } from "../api";
import { ko } from "../i18n/ko";
import { formatPrice } from "../lib/format";
import {
  formatInvestorNetQty,
  investorNetQtyClass,
} from "../lib/formatInvestorFlow";
import type { KrInvestorFlowItem, KrInvestorFlowResponse } from "../types";

type RankKey = "foreign" | "institution" | "individual";

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

export default function InvestorFlowTab() {
  const [data, setData] = useState<KrInvestorFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankKey, setRankKey] = useState<RankKey>("foreign");
  const [query, setQuery] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchKrInvestorFlow();
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
      void load(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((row) => {
          const sym = row.symbol.replace(/\.(KS|KQ)$/i, "").toLowerCase();
          return (
            row.name.toLowerCase().includes(q) ||
            sym.includes(q) ||
            row.symbol.toLowerCase().includes(q)
          );
        })
      : items;
    return [...filtered].sort((a, b) => {
      const av = qtyForKey(a, rankKey);
      const bv = qtyForKey(b, rankKey);
      const an = av == null ? -Infinity : av;
      const bn = bv == null ? -Infinity : bv;
      return bn - an;
    });
  }, [data?.items, query, rankKey]);

  const rankTabs: { id: RankKey; label: string }[] = [
    { id: "foreign", label: ko.investorFlow.rankForeign },
    { id: "institution", label: ko.investorFlow.rankInstitution },
    { id: "individual", label: ko.investorFlow.rankIndividual },
  ];

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
            onClick={() => void load()}
          >
            {loading ? ko.investorFlow.loading : ko.investorFlow.refresh}
          </button>
        </div>
      </header>

      <div className="investor-flow-tab__rank-tabs market-tabs" role="tablist">
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

      {error ? (
        <p className="investor-flow-tab__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !data?.items?.length ? (
        <p className="investor-flow-tab__muted">{ko.investorFlow.loading}</p>
      ) : rows.length === 0 ? (
        <p className="investor-flow-tab__muted">{ko.investorFlow.empty}</p>
      ) : (
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
              {rows.map((row, idx) => (
                <tr key={row.symbol}>
                  <td className="investor-flow-tab__col--rank">{idx + 1}</td>
                  <td className="investor-flow-tab__col--name">
                    <span className="investor-flow-tab__name">{row.name}</span>
                    <span className="investor-flow-tab__sym">
                      {row.symbol.replace(/\.(KS|KQ)$/i, "")}
                    </span>
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
                    {row.foreignHoldRatio != null
                      ? `${row.foreignHoldRatio.toFixed(2)}%`
                      : "—"}
                  </td>
                  <td>
                    {row.closePrice != null
                      ? formatPrice(row.closePrice, "KRW")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
