export type Sp500SectorRow = {
  sector: string;
  sectorKo: string;
  count: number;
  pct: number;
};

export type Sp500CompanyRow = {
  symbol: string;
  name: string;
  sector: string;
  sectorKo: string;
  subIndustry: string;
  headquarters: string;
  dateAdded: string;
};

export type Sp500SectorsPayload = {
  updatedAt: number;
  total: number;
  weightBasis: string;
  weightBasisLabel: string;
  sectors: Sp500SectorRow[];
  companies: Sp500CompanyRow[];
};

export const SP500_SECTOR_COLORS: Record<string, string> = {
  "Information Technology": "#38bdf8",
  "Health Care": "#34d399",
  Financials: "#fbbf24",
  "Consumer Discretionary": "#fb7185",
  "Communication Services": "#a78bfa",
  Industrials: "#94a3b8",
  "Consumer Staples": "#4ade80",
  Energy: "#f97316",
  Utilities: "#60a5fa",
  "Real Estate": "#e879f9",
  Materials: "#facc15",
  Unknown: "#64748b",
};

export function sp500SectorColor(sector: string): string {
  return SP500_SECTOR_COLORS[sector] ?? "#64748b";
}

export function fmtSectorPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function fmtSp500DateAdded(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function sp500DateSortMs(raw: string): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function polarPoint(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function donutArcPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const p0 = polarPoint(cx, cy, r1, a0);
  const p1 = polarPoint(cx, cy, r1, a1);
  const p2 = polarPoint(cx, cy, r0, a1);
  const p3 = polarPoint(cx, cy, r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}

export type DonutSegment = {
  sector: string;
  sectorKo: string;
  count: number;
  pct: number;
  a0: number;
  a1: number;
  color: string;
};

export function buildDonutSegments(
  sectors: Sp500SectorRow[],
  total: number,
): DonutSegment[] {
  let angle = 0;
  return sectors.map((s) => {
    const sweep = total > 0 ? (s.count / total) * 360 : 0;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    return {
      ...s,
      a0,
      a1,
      color: sp500SectorColor(s.sector),
    };
  });
}
