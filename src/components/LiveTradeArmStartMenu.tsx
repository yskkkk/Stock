import { useMemo } from "react";
import type { LiveTradeArmLane } from "../api";
import { ko } from "../i18n/ko";
import type { LiveArmLaneOption } from "../lib/liveTradeArmLanes";

export default function LiveTradeArmStartMenu({
  options,
  busy,
  onSelect,
  triggerLabel = ko.app.liveTradeArm,
  className = "",
}: {
  options: LiveArmLaneOption[];
  busy: boolean;
  onSelect: (lane: LiveTradeArmLane) => void;
  triggerLabel?: string;
  className?: string;
}) {
  const visible = useMemo(() => options.length > 0, [options.length]);
  if (!visible) return null;

  const anyEnabled = options.some((o) => o.enabled);

  return (
    <div
      className={["live-trade-arm-menu", className].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        className="btn btn--secondary btn--sm live-trade-arm-menu__trigger"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={false}
        title={
          anyEnabled
            ? ko.app.liveTradeArmMenuTriggerHint
            : ko.app.liveTradeArmMenuNoneReady
        }
      >
        <span>{triggerLabel}</span>
        <span className="live-trade-arm-menu__caret" aria-hidden>
          ▾
        </span>
      </button>
      <div className="live-trade-arm-menu__panel" role="menu">
        {options.map((opt) => (
          <button
            key={opt.lane}
            type="button"
            role="menuitem"
            className={[
              "live-trade-arm-menu__item",
              opt.enabled ? "" : "live-trade-arm-menu__item--disabled",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={busy || !opt.enabled}
            title={opt.title}
            onClick={() => onSelect(opt.lane)}
          >
            <span className="live-trade-arm-menu__item-label">{opt.label}</span>
            {!opt.enabled ? (
              <span className="live-trade-arm-menu__item-badge">
                {ko.app.liveTradeArmMenuNeedLink}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
