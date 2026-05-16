import { FILTER_PRESETS } from "../constants/filterPresets";
import { FILTER_OPTIONS, type SignalId } from "../constants/signals";
import type { FilterMode } from "../lib/filterPicks";

interface SignalFilterProps {
  selected: SignalId[];
  mode: FilterMode;
  onChange: (next: SignalId[]) => void;
  onModeChange: (mode: FilterMode) => void;
}

export default function SignalFilter({
  selected,
  mode,
  onChange,
  onModeChange,
}: SignalFilterProps) {
  function toggle(id: SignalId) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  function applyPreset(signalIds: SignalId[]) {
    onChange(signalIds);
    onModeChange("or");
  }

  return (
    <div className="signal-filter">
      <div className="filter-header">
        <span className="filter-title">조건 필터</span>
        <div className="filter-mode-seg">
          <button
            type="button"
            className={mode === "and" ? "seg active" : "seg"}
            onClick={() => onModeChange("and")}
          >
            AND
          </button>
          <button
            type="button"
            className={mode === "or" ? "seg active" : "seg"}
            onClick={() => onModeChange("or")}
          >
            OR
          </button>
        </div>
        {selected.length > 0 && (
          <button type="button" className="filter-clear" onClick={() => onChange([])}>
            초기화
          </button>
        )}
      </div>
      <div className="filter-presets">
        {FILTER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip preset"
            onClick={() => applyPreset(p.signalIds)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="filter-chips">
        {FILTER_OPTIONS.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={active ? "chip active" : "chip"}
              onClick={() => toggle(opt.id)}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
