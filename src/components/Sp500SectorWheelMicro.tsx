import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import {
  buildDonutSegments,
  donutArcPath,
  fmtSectorPct,
} from "../lib/sp500SectorChart";

function Sp500SectorWheelMicroInner() {
  const { data, loading, error, openSectorDetail, openPanel } = useSp500Sector();
  const [tipOpen, setTipOpen] = useState(false);
  const [tipStyle, setTipStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(
    () => (data ? buildDonutSegments(data.sectors, data.total) : []),
    [data],
  );

  const sortedSectors = useMemo(
    () => (data ? [...data.sectors].sort((a, b) => b.pct - a.pct) : []),
    [data],
  );

  const sectorColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of segments) map.set(seg.sector, seg.color);
    return map;
  }, [segments]);

  const showTip = useCallback(() => setTipOpen(true), []);
  const hideTip = useCallback(() => {
    setTipOpen(false);
    setTipStyle({ visibility: "hidden" });
  }, []);

  const positionTip = useCallback(() => {
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;

    const margin = 10;
    const gap = 8;
    const wrapRect = wrap.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let left = wrapRect.right + gap;
    let top = wrapRect.top;

    if (left + tipRect.width > viewW - margin) {
      left = wrapRect.left - gap - tipRect.width;
    }
    if (left < margin) {
      left = margin;
    }

    const maxTop = viewH - margin - tipRect.height;
    top = Math.max(margin, Math.min(top, maxTop));

    setTipStyle({
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      transform: "none",
      visibility: "visible",
      maxHeight: `${viewH - margin * 2}px`,
    });
  }, []);

  useLayoutEffect(() => {
    if (!tipOpen) return;
    positionTip();
    const onReflow = () => positionTip();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [tipOpen, positionTip, sortedSectors.length]);

  if (loading) {
    return (
      <div
        className="sp500-wheel-micro sp500-wheel-micro--loading"
        aria-label={ko.app.sp500SectorAria}
        aria-busy="true"
      />
    );
  }

  if (error || !data) {
    return null;
  }

  const cx = 100;
  const cy = 100;
  const r0 = 58;
  const r1 = 92;

  return (
    <div ref={wrapRef} className="sp500-wheel-micro-wrap">
      <button
        type="button"
        className="sp500-wheel-micro"
        aria-label={ko.app.sp500SectorMicroAria}
        aria-describedby={tipOpen ? "sp500-wheel-micro-tip" : undefined}
        onClick={() => openPanel("chart")}
        onMouseEnter={showTip}
        onFocus={showTip}
        onMouseLeave={hideTip}
        onBlur={hideTip}
      >
        <svg viewBox="0 0 200 200" className="sp500-wheel-micro__svg" aria-hidden>
          {segments.map((seg) => (
            <path
              key={seg.sector}
              className="sp500-wheel-micro__seg"
              d={donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)}
              fill={seg.color}
              onClick={(e) => {
                e.stopPropagation();
                openSectorDetail(seg.sector, "list");
              }}
            />
          ))}
          <text
            className="sp500-wheel-micro__center"
            x={cx}
            y={cy - 3}
            textAnchor="middle"
          >
            S&P
          </text>
          <text
            className="sp500-wheel-micro__center"
            x={cx}
            y={cy + 11}
            textAnchor="middle"
          >
            500
          </text>
        </svg>
      </button>
      {tipOpen ? (
        <div
          ref={tipRef}
          id="sp500-wheel-micro-tip"
          className="sp500-wheel-micro__tip"
          style={tipStyle}
          role="tooltip"
        >
          <p className="sp500-wheel-micro__tip-title">{ko.app.sp500SectorTitle}</p>
          <ul className="sp500-wheel-micro__tip-list">
            {sortedSectors.map((s) => (
              <li key={s.sector} className="sp500-wheel-micro__tip-row">
                <span
                  className="sp500-wheel-micro__tip-swatch"
                  style={{ background: sectorColors.get(s.sector) }}
                  aria-hidden
                />
                <span className="sp500-wheel-micro__tip-name">{s.sectorKo}</span>
                <span className="sp500-wheel-micro__tip-pct">{fmtSectorPct(s.pct)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const Sp500SectorWheelMicro = memo(Sp500SectorWheelMicroInner);
export default Sp500SectorWheelMicro;
