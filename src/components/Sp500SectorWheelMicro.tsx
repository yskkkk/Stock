import { memo, useCallback, useMemo, useState, type MouseEvent } from "react";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import {
  buildDonutSegments,
  donutArcPath,
  fmtSectorPct,
} from "../lib/sp500SectorChart";

type TipState = {
  x: number;
  y: number;
  label: string;
};

function Sp500SectorWheelMicroInner() {
  const { data, loading, error, openSectorDetail, openPanel } = useSp500Sector();
  const [tip, setTip] = useState<TipState | null>(null);

  const segments = useMemo(
    () => (data ? buildDonutSegments(data.sectors, data.total) : []),
    [data],
  );

  const hideTip = useCallback(() => setTip(null), []);

  const showTip = useCallback(
    (e: MouseEvent, sectorKo: string, pct: number, count: number) => {
      setTip({
        x: e.clientX,
        y: e.clientY,
        label: ko.app.sp500SectorMicroTip
          .replace("{name}", sectorKo)
          .replace("{pct}", fmtSectorPct(pct))
          .replace("{count}", String(count)),
      });
    },
    [],
  );

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
        onClick={() => openPanel("chart")}
        onMouseLeave={hideTip}
      >
        <svg viewBox="0 0 200 200" className="sp500-wheel-micro__svg" aria-hidden>
          {segments.map((seg) => (
            <path
              key={seg.sector}
              className="sp500-wheel-micro__seg"
              d={donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)}
              fill={seg.color}
              onMouseEnter={(e) => showTip(e, seg.sectorKo, seg.pct, seg.count)}
              onMouseMove={(e) => showTip(e, seg.sectorKo, seg.pct, seg.count)}
              onMouseLeave={hideTip}
              onClick={(e) => {
                e.stopPropagation();
                openSectorDetail(seg.sector, "list");
              }}
            />
          ))}
        </svg>
      </button>
      {tip ? (
        <div
          className="sp500-wheel-micro__tip"
          style={{ left: tip.x, top: tip.y }}
          role="tooltip"
        >
          {tip.label}
        </div>
      ) : null}
    </div>
  );
}

const Sp500SectorWheelMicro = memo(Sp500SectorWheelMicroInner);
export default Sp500SectorWheelMicro;
