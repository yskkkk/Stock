import { useEffect, useId, useState } from "react";
import { ko } from "../i18n/ko";

export type IndustryFilterOption = {
  name: string;
  count: number;
};

export default function IndustryFilterPanel({
  ariaLabel,
  totalCount,
  industryFilter,
  onSelectAll,
  industryOptions,
  industryGrid,
  onToggleIndustry,
}: {
  ariaLabel: string;
  totalCount: number;
  industryFilter: string;
  onSelectAll: () => void;
  industryOptions: IndustryFilterOption[];
  industryGrid: { rows: number; cols: number };
  onToggleIndustry: (name: string) => void;
}) {
  const gridId = useId();
  const [expanded, setExpanded] = useState(false);
  const selected =
    industryFilter !== "all"
      ? industryOptions.find((o) => o.name === industryFilter)
      : null;

  useEffect(() => {
    if (industryFilter !== "all") setExpanded(true);
  }, [industryFilter]);

  return (
    <div
      className="stock-vault-tab__filters stock-vault-tab__filters--industry investor-flow-tab__industry-filters"
      role="tablist"
      aria-label={ariaLabel}
    >
      <div className="stock-vault-tab__industry-head">
        <button
          type="button"
          role="tab"
          aria-selected={industryFilter === "all"}
          className={
            industryFilter === "all"
              ? "market-tab market-tab--industry-all active"
              : "market-tab market-tab--industry-all"
          }
          onClick={onSelectAll}
        >
          <span className="market-tab__label">{ko.investorFlow.industryAll}</span>
          <span className="market-tab__count">{totalCount}</span>
        </button>

        {!expanded && selected ? (
          <button
            type="button"
            role="tab"
            aria-selected
            className="market-tab active stock-vault-tab__industry-selected-chip"
            onClick={() => onToggleIndustry(selected.name)}
          >
            <span className="market-tab__label">{selected.name}</span>
            <span className="market-tab__count">{selected.count}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="stock-vault-tab__industry-expand"
          aria-expanded={expanded}
          aria-controls={gridId}
          onClick={() => setExpanded((v) => !v)}
        >
          <span>
            {expanded ? ko.investorFlow.industryCollapse : ko.investorFlow.industryExpand}
          </span>
          <span className="stock-vault-tab__industry-expand-chevron" aria-hidden>
            {expanded ? "▴" : "▾"}
          </span>
        </button>
      </div>

      {expanded ? (
        <div id={gridId} className="stock-vault-tab__industry-grid-scroll">
          <div
            className="stock-vault-tab__industry-grid"
            style={
              {
                "--stock-vault-industry-rows": String(industryGrid.rows),
                "--stock-vault-industry-cols": String(industryGrid.cols),
              } as React.CSSProperties
            }
          >
            {industryOptions.map(({ name, count }) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={industryFilter === name}
                className={
                  industryFilter === name
                    ? "market-tab active"
                    : count > 0
                      ? "market-tab"
                      : "market-tab market-tab--empty"
                }
                onClick={() => onToggleIndustry(name)}
              >
                <span className="market-tab__label">{name}</span>
                <span className="market-tab__count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
