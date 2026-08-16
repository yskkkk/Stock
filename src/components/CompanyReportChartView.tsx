import type { CompanyReportChart } from "../api";

const COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed"];

function fmtAxis(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (unit === "KRW") {
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(0)}억`;
    return `${sign}${Math.round(abs).toLocaleString("ko-KR")}`;
  }
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}조$`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억$`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${abs.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}`;
}

function allYs(chart: CompanyReportChart): number[] {
  return chart.series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
}

export default function CompanyReportChartView({
  chart,
}: {
  chart: CompanyReportChart;
}) {
  const ys = allYs(chart);
  if (!ys.length) return null;
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const span = maxY - minY || 1;
  const padL = 48;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const W = 560;
  const H = 220;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xs =
    chart.series[0]?.points.map((p) => p.x) ??
    Array.from(
      new Set(chart.series.flatMap((s) => s.points.map((p) => p.x))),
    );

  const yScale = (y: number) => padT + plotH - ((y - minY) / span) * plotH;
  const zeroY = yScale(0);

  const n = Math.max(xs.length, 1);
  const groupW = plotW / n;
  const seriesCount = Math.max(chart.series.length, 1);
  const barW = Math.min(36, (groupW * 0.7) / seriesCount);

  return (
    <figure className="co-report__chart">
      <figcaption className="co-report__chart-title">{chart.title}</figcaption>
      <svg
        className="co-report__chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={chart.title}
      >
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={padT + plotH}
          className="co-report__chart-axis"
        />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={padL + plotW}
          y2={padT + plotH}
          className="co-report__chart-axis"
        />
        {minY < 0 && maxY > 0 ? (
          <line
            x1={padL}
            y1={zeroY}
            x2={padL + plotW}
            y2={zeroY}
            className="co-report__chart-zero"
          />
        ) : null}
        <text
          x={padL - 6}
          y={padT + 4}
          textAnchor="end"
          className="co-report__chart-tick"
        >
          {fmtAxis(maxY, chart.unit)}
        </text>
        <text
          x={padL - 6}
          y={padT + plotH}
          textAnchor="end"
          className="co-report__chart-tick"
        >
          {fmtAxis(minY, chart.unit)}
        </text>

        {chart.series.map((serie, si) =>
          serie.points.map((pt, pi) => {
            const xi = xs.indexOf(pt.x);
            const idx = xi >= 0 ? xi : pi;
            const cx =
              padL +
              idx * groupW +
              groupW / 2 +
              (si - (seriesCount - 1) / 2) * (barW + 2);
            const y = yScale(pt.y);
            const top = Math.min(y, zeroY);
            const h = Math.max(1.5, Math.abs(y - zeroY));
            return (
              <g key={`${serie.name}-${pt.x}-${si}`}>
                <rect
                  x={cx - barW / 2}
                  y={top}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={COLORS[si % COLORS.length]}
                  opacity={0.9}
                />
                <title>
                  {`${serie.name} ${pt.x}: ${fmtAxis(pt.y, chart.unit)}`}
                </title>
              </g>
            );
          }),
        )}

        {xs.map((x, i) => (
          <text
            key={x}
            x={padL + i * groupW + groupW / 2}
            y={H - 10}
            textAnchor="middle"
            className="co-report__chart-tick"
          >
            {x}
          </text>
        ))}
      </svg>
      {chart.series.length > 1 ? (
        <ul className="co-report__chart-legend">
          {chart.series.map((s, i) => (
            <li key={s.name}>
              <span
                className="co-report__chart-swatch"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
