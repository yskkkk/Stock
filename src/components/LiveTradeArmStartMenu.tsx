import { useCallback, useMemo, useRef, useState } from "react";
import type { LiveTradeArmLane } from "../api";
import { ko } from "../i18n/ko";
import type { LiveArmLaneOption } from "../lib/liveTradeArmLanes";
import { BithumbBrandMark, TossBrandMark } from "./ExchangeBrandMarks";

function ArmLaneMark({ lane }: { lane: LiveTradeArmLane }) {
  if (lane === "bithumb") {
    return <BithumbBrandMark className="live-trade-arm-menu__mark" />;
  }
  return <TossBrandMark className="live-trade-arm-menu__mark" />;
}

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);

  const syncDropDirection = useCallback(() => {
    // panel이 보이기 전이면(open false) 측정 불가
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const r = root.getBoundingClientRect();
    const ph = panel.offsetHeight || 0;
    // 아래 공간이 부족하면 위로 펼침
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const shouldUp = ph > 0 && spaceBelow < ph + 10 && spaceAbove > spaceBelow;
    setDropUp(shouldUp);
  }, []);

  const openMenu = useCallback(() => {
    if (busy) return;
    setOpen(true);
    // 다음 프레임에 측정 (display가 생긴 뒤 높이 확보)
    window.requestAnimationFrame(() => syncDropDirection());
  }, [busy, syncDropDirection]);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <div
      ref={rootRef}
      className={[
        "live-trade-arm-menu",
        open ? "live-trade-arm-menu--open" : "",
        dropUp ? "live-trade-arm-menu--up" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={openMenu}
      onMouseLeave={closeMenu}
    >
      <button
        type="button"
        className="btn btn--secondary btn--sm live-trade-arm-menu__trigger"
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          anyEnabled
            ? ko.app.liveTradeArmMenuTriggerHint
            : ko.app.liveTradeArmMenuNoneReady
        }
        onFocus={openMenu}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && rootRef.current?.contains(next)) return;
          closeMenu();
        }}
      >
        <span>{triggerLabel}</span>
        <span className="live-trade-arm-menu__caret" aria-hidden>
          ▾
        </span>
      </button>
      <div className="live-trade-arm-menu__drop">
        <div
          ref={panelRef}
          className="live-trade-arm-menu__panel"
          role="menu"
        >
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
              onClick={() => {
                closeMenu();
                onSelect(opt.lane);
              }}
            >
              <span className="live-trade-arm-menu__item-main">
                <ArmLaneMark lane={opt.lane} />
                <span className="live-trade-arm-menu__item-label">{opt.label}</span>
              </span>
              {!opt.enabled ? (
                <span className="live-trade-arm-menu__item-badge">
                  {ko.app.liveTradeArmMenuNeedLink}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
