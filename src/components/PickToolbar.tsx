import type { SortKey } from "../lib/sortPicks";

interface PickToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "score", label: "점수순" },
  { value: "change", label: "등락률순" },
  { value: "name", label: "이름순" },
];

export default function PickToolbar({
  search,
  onSearchChange,
  sortKey,
  onSortChange,
}: PickToolbarProps) {
  return (
    <div className="pick-toolbar">
      <input
        type="search"
        className="pick-search"
        placeholder="종목·심볼 검색"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="종목 검색"
      />
      <select
        className="pick-sort"
        value={sortKey}
        onChange={(e) => onSortChange(e.target.value as SortKey)}
        aria-label="정렬"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
