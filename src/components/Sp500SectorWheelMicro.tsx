import { memo, useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ko } from "../i18n/ko";
import { useSp500Sector } from "../contexts/Sp500SectorContext";
import { useIsMobilePhone } from "../hooks/useIsMobilePhone";
import {
  buildDonutSegments,
  donutArcPath,
  donutArcPathPopOut,
  fmtSectorPct,
  type DonutSegment,
  type Sp500SectorRow,
} from "../lib/sp500SectorChart";

type DonutSvgProps = {
  segments: DonutSegment[];
  total: number;
  focusRow: Sp500SectorRow | null;
  focusSector: string | null;
  hoveredSector: string | null;
  interactive: boolean;
  svgClassName: string;
  segClassPrefix: "sp500-wheel-mini" | "sp500-wheel-micro";
  onSegmentClick?: (sector: string) => void;
  onSectorHover?: (sector: string | null) => void;
  r0?: number;
  r1?: number;
};

function Sp500SectorDonutSvg({
  segments,
  total,
  focusRow,
  focusSector,
  hoveredSector,
  interactive,
  svgClassName,
  segClassPrefix,
  onSegmentClick,
  onSectorHover,
  r0 = 52,
  r1 = 88,
}: DonutSvgProps) {
  const cx = 100;
  const cy = 100;
  const miniStyle = segClassPrefix === "sp500-wheel-mini";

  return (
    <svg
      className={svgClassName}
      viewBox="0 0 200 200"
      role={interactive ? "img" : undefined}
      aria-hidden={!interactive}
    >
      {[...segments]
        .sort((a, b) => {
          const aLift = hoveredSector === a.sector ? 1 : 0;
          const bLift = hoveredSector === b.sector ? 1 : 0;
          return aLift - bLift;
        })
        .map((seg) => {
          const lifted = hoveredSector === seg.sector;
          const dimmed = focusSector && focusSector !== seg.sector;
          const segClass = [
            `${segClassPrefix}__seg`,
            lifted ? `${segClassPrefix}__seg--lifted` : "",
            dimmed ? `${segClassPrefix}__seg--dim` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <path
              key={seg.sector}
              className={segClass}
              d={
                lifted
                  ? donutArcPathPopOut(cx, cy, r0, r1, seg.a0, seg.a1)
                  : donutArcPath(cx, cy, r0, r1, seg.a0, seg.a1)
              }
              fill={seg.color}
              onClick={
                interactive && onSegmentClick
                  ? (e) => {
                      e.stopPropagation();
                      onSegmentClick(seg.sector);
                    }
                  : undefined
              }
              onMouseEnter={
                interactive && onSectorHover
                  ? () => onSectorHover(seg.sector)
                  : undefined
              }
              onMouseLeave={
                interactive && onSectorHover ? () => onSectorHover(null) : undefined
              }
            />
          );
        })}
      {miniStyle ? (
        <>
          <text
            className="sp500-wheel-mini__center-label"
            x={cx}
            y={cy - (focusRow ? 10 : 4)}
            textAnchor="middle"
          >
            {focusRow ? focusRow.sectorKo : "S&P 500"}
          </text>
          {focusRow ? (
            <text
              className="sp500-wheel-mini__center-en"
              x={cx}
              y={cy + 4}
              textAnchor="middle"
            >
              {focusRow.sector}
            </text>
          ) : null}
          <text
            className="sp500-wheel-mini__center-value"
            x={cx}
            y={cy + (focusRow ? 22 : 16)}
            textAnchor="middle"
          >
            {focusRow ? `${focusRow.count} · ${fmtSectorPct(focusRow.pct)}` : total}
          </text>
        </>
      ) : focusRow ? (
        <>
          <text
            className="sp500-wheel-micro__center sp500-wheel-micro__center--focus"
            x={cx}
            y={cy - 6}
            textAnchor="middle"
          >
            {focusRow.sectorKo}
          </text>
          <text
            className="sp500-wheel-micro__center-value"
            x={cx}
            y={cy + 10}
            textAnchor="middle"
          >
            {focusRow.count}
          </text>
          <text
            className="sp500-wheel-micro__center-sub"
            x={cx}
            y={cy + 22}
            textAnchor="middle"
          >
            {fmtSectorPct(focusRow.pct)}
          </text>
        </>
      ) : (
        <>
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
        </>
      )}
    </svg>
  );
}

function Sp500SectorWheelMicroInner() {
  const { data, loading, error, openSectorDetail, openPanel } = useSp500Sector();
  const mobile = useIsMobilePhone();
  const [expanded, setExpanded] = useState(false);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const segments = useMemo(
    () => (data ? buildDonutSegments(data.sectors, data.total) : []),
    [data],
  );

  const focusSector = hoveredSector;
  const focusRow = useMemo(
    () =>
      focusSector && data
        ? data.sectors.find((s) => s.sector === focusSector) ?? null
        : null,
    [data, focusSector],
  );

  const collapse = useCallback(() => {
    setExpanded(false);
    setHoveredSector(null);
  }, []);

  const expand = useCallback(() => {
    if (!mobile) setExpanded(true);
  }, [mobile]);

  const pickSector = useCallback(
    (sector: string) => {
      openSectorDetail(sector, "list");
      collapse();
    },
    [collapse, openSectorDetail],
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

  const expandOverlay =
    expanded && typeof document !== "undefined"
      ? createPortal(
          <div
            className="sp500-wheel-micro-expand"
            onMouseLeave={mobile ? undefined : collapse}
            onClick={mobile ? collapse : undefined}
          >
            <div
              className="sp500-wheel-micro-expand__panel"
              role="dialog"
              aria-label={ko.app.sp500SectorTitle}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={mobile ? undefined : expand}
            >
              <div className="sp500-wheel-micro-expand__head">
                <div>
                  <h3 className="sp500-wheel-micro-expand__title">
                    {ko.app.sp500SectorTitle}
                  </h3>
                  <p className="sp500-wheel-micro-expand__sub">
                    {data.weightBasisLabel ?? ko.app.sp500SectorBasis} · {data.total}
                    {ko.app.sp500SectorCompaniesUnit}
                  </p>
                </div>
                <button
                  type="button"
                  className="sp500-wheel-micro-expand__open-tab"
                  onClick={() => {
                    openPanel("chart");
                    collapse();
                  }}
                >
                  {ko.app.sp500SectorOpenFull}
                </button>
              </div>
              <div className="sp500-wheel-mini__chart-panel sp500-wheel-micro-expand__chart">
                <Sp500SectorDonutSvg
                  segments={segments}
                  total={data.total}
                  focusRow={focusRow}
                  focusSector={focusSector}
                  hoveredSector={hoveredSector}
                  interactive
                  svgClassName="sp500-wheel-mini__svg sp500-wheel-micro-expand__svg"
                  segClassPrefix="sp500-wheel-mini"
                  onSegmentClick={pickSector}
                  onSectorHover={setHoveredSector}
                  r0={52}
                  r1={88}
                />
                <ul className="sp500-wheel-mini__legend sp500-wheel-micro-expand__legend">
                  {data.sectors.map((s) => (
                    <li key={s.sector}>
                      <button
                        type="button"
                        className={
                          hoveredSector === s.sector
                            ? "sp500-wheel-mini__legend-btn sp500-wheel-mini__legend-btn--hovered"
                            : "sp500-wheel-mini__legend-btn"
                        }
                        onClick={() => pickSector(s.sector)}
                        onMouseEnter={() => setHoveredSector(s.sector)}
                        onMouseLeave={() => setHoveredSector(null)}
                      >
                        <span
                          className="sp500-wheel-mini__swatch"
                          style={{
                            background: segments.find((x) => x.sector === s.sector)?.color,
                          }}
                        />
                        <span className="sp500-wheel-mini__legend-text">
                          <span className="sp500-wheel-mini__legend-label">{s.sectorKo}</span>
                          <span className="sp500-wheel-mini__legend-en">{s.sector}</span>
                        </span>
                        <span className="sp500-wheel-mini__legend-pct">
                          {fmtSectorPct(s.pct)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="sp500-wheel-micro-wrap">
        <button
          type="button"
          className="sp500-wheel-micro"
          aria-label={ko.app.sp500SectorMicroAria}
          aria-expanded={expanded}
          onClick={() => {
            if (mobile) {
              setExpanded((v) => !v);
              return;
            }
            openPanel("chart");
          }}
          onMouseEnter={expand}
        >
          <Sp500SectorDonutSvg
            segments={segments}
            total={data.total}
            focusRow={null}
            focusSector={null}
            hoveredSector={null}
            interactive={false}
            svgClassName="sp500-wheel-micro__svg"
            segClassPrefix="sp500-wheel-micro"
            r0={58}
            r1={92}
          />
        </button>
      </div>
      {expandOverlay}
    </>
  );
}

const Sp500SectorWheelMicro = memo(Sp500SectorWheelMicroInner);
export default Sp500SectorWheelMicro;
