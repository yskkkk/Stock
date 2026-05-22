import { FILTER_PRESETS } from "../constants/filterPresets";
import { FILTER_OPTIONS, type SignalId } from "../constants/signals";
import { getSignalHint } from "../constants/signalHints";
import type { FilterMode } from "../lib/filterPicks";
import SignalHintWrap from "./SignalHintWrap";

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
          <SignalHintWrap key={p.id} hint={p.hint} label={p.label}>
            <button
              type="button"
              className="chip preset"
              title={p.hint}
              onClick={() => applyPreset(p.signalIds)}
            >
              {p.label}
            </button>
          </SignalHintWrap>
        ))}
      </div>
      <div className="filter-chips">
        {FILTER_OPTIONS.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <SignalHintWrap
              key={opt.id}
              hint={getSignalHint(opt.id)}
              label={opt.label}
            >
              <button
                type="button"
                className={active ? "chip active" : "chip"}
                title={getSignalHint(opt.id)}
                onClick={() => toggle(opt.id)}
                aria-pressed={active}
              >
                {opt.label}
              </button>
            </SignalHintWrap>
          );
        })}
      </div>
    </div>
  );
}
