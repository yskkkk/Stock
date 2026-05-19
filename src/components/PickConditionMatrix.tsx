import { memo } from "react";
import { SIGNAL_CHIPS, resolvePickSignalIds } from "../constants/signalChips";
import type { StockPick } from "../types";

export function PickConditionHeader() {
  return (
    <div className="pick-cond-matrix__head" role="row" aria-hidden>
      {SIGNAL_CHIPS.map((chip) => (
        <span key={chip.id} className="pick-cond-matrix__col-head" title={chip.label}>
          {chip.short}
        </span>
      ))}
    </div>
  );
}

interface PickConditionRowProps {
  pick: StockPick;
}

export const PickConditionRow = memo(function PickConditionRow({
  pick,
}: PickConditionRowProps) {
  const active = new Set(resolvePickSignalIds(pick));

  return (
    <div
      className="pick-cond-matrix__row"
      role="row"
      aria-label="기술적 조건 충족 여부"
    >
      {SIGNAL_CHIPS.map((chip) => {
        const on = active.has(chip.id);
        return (
          <span
            key={chip.id}
            className={
              on
                ? `pick-cond-matrix__cell pick-cond-matrix__cell--on ${chip.className}`
                : "pick-cond-matrix__cell pick-cond-matrix__cell--off"
            }
            title={`${chip.label}: ${on ? "충족" : "미충족"}`}
            aria-label={`${chip.label} ${on ? "충족" : "미충족"}`}
          >
            {on ? chip.short : "—"}
          </span>
        );
      })}
    </div>
  );
});
