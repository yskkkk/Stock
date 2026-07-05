import { memo, useCallback, useMemo, useState } from "react";
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
  const hideTip = useCallback(() => setTipOpen(false), []);

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
    <div className="sp500-wheel-micro-wrap">
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
          id="sp500-wheel-micro-tip"
          className="sp500-wheel-micro__tip"
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
