/**
 * 재무제표 전년 대비·동종업계 AI 의견(규칙 기반)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import { extractPeriodMetricsFromDetail } from "./stock-financial-period-metrics.js";
import { buildHistoricalPeriodMetrics } from "./stock-financial-period-valuation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECTOR_CONFIG_PATH = path.join(__dirname, "data", "sector-earnings-spotlight.json");

/** @param {string} label */
function normLabel(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** @param {string} value @param {string} [unitNote] */
export function parseStatementNumber(value, unitNote = "") {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === "—" || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const m = s.replace(/,/g, "").match(/([+-]?[\d.]+)/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (neg) n = -n;
  if (unitNote.includes("억원") || unitNote.includes("million") || unitNote.includes("M")) {
    /* display unit already applied in string magnitude */
  }
  return n;
}

/** @param {number | null} cur @param {number | null} prior */
export function calcYoyPct(cur, prior) {
  if (cur == null || prior == null || !Number.isFinite(cur) || !Number.isFinite(prior)) {
    return null;
  }
  if (Math.abs(prior) < 1e-12) return null;
  return ((cur - prior) / Math.abs(prior)) * 100;
}

/** @param {object[]} periods @param {object} current */
export function findPriorPeriod(periods, current) {
  if (!current?.endDateMs) return null;
  const isQuarter = current.kind === "quarter";
  const targetMs = current.endDateMs - (isQuarter ? 365.25 : 365.25) * 86400000;
  const maxDiffMs = (isQuarter ? 75 : 400) * 86400000;
  let best = null;
  let bestDiff = Infinity;
  for (const p of periods) {
    if (!p || p.id === current.id) continue;
    if (p.kind !== current.kind) continue;
    if (p.isForecast) continue;
    if (current.isForecast) continue;
    if (!p.endDateMs) continue;
    const diff = Math.abs(p.endDateMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  if (!best || bestDiff > maxDiffMs) return null;
  return best;
}

/** @param {object[]} sections @param {string} unitNote */
function flattenRows(sections, unitNote = "") {
  /** @type {{ label: string; value: string; numeric: number | null }[]} */
  const out = [];
  for (const sec of sections ?? []) {
    const note = sec?.unitNote || unitNote;
    for (const row of sec?.rows ?? []) {
      out.push({
        label: row.label,
        value: row.value,
        numeric: parseStatementNumber(row.value, note),
      });
    }
  }
  return out;
}

/** @param {object[]} currentSections @param {object[] | null} priorSections */
function mergeYoySections(currentSections, priorSections) {
  const priorFlat = flattenRows(priorSections ?? []);
  const priorByLabel = new Map(priorFlat.map((r) => [normLabel(r.label), r]));

  return (currentSections ?? []).map((sec) => ({
    ...sec,
    rows: (sec.rows ?? []).map((row) => {
      const prior = priorByLabel.get(normLabel(row.label));
      const curNum = parseStatementNumber(row.value, sec.unitNote);
      const priorNum = prior?.numeric ?? null;
      const yoyPct = calcYoyPct(curNum, priorNum);
      return {
        label: row.label,
        value: row.value,
        priorValue: prior?.value ?? null,
        yoyPct,
      };
    }),
  }));
}

/** @param {string} symbol */
function loadPeerGroup(symbol) {
  try {
    const raw = fs.readFileSync(SECTOR_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const sectors = Array.isArray(parsed.sectors) ? parsed.sectors : [];
    const symU = String(symbol ?? "").trim().toUpperCase();
    for (const s of sectors) {
      const syms = Array.isArray(s.symbols) ? s.symbols : [];
      if (syms.some((x) => String(x).trim().toUpperCase() === symU)) {
        return {
          peerGroup: String(s.label ?? "동종 업종").trim() || "동종 업종",
          peers: syms
            .map((x) => String(x).trim().toUpperCase())
            .filter((x) => x && x !== symU)
            .slice(0, 6),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { peerGroup: "동종 업종", peers: [] };
}

/** @param {number[]} vals */
function median(vals) {
  const a = vals.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** @param {number | null} v @param {number} d */
function fmtNum(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

/** @param {number | null} pct */
function fmtYoy(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/** @param {string} label @param {object[]} flatRows */
function findRowMetric(flatRows, patterns) {
  for (const row of flatRows) {
    const n = normLabel(row.label);
    if (patterns.some((p) => n.includes(p))) return row;
  }
  return null;
}

/**
 * @param {object} input
 */
function buildAiOpinion(input) {
  const {
    name,
    peerGroup,
    fundamentals,
    peerMedians,
    yoyFlat,
    priorLabel,
    isForecast,
  } = input;

  /** @type {string[]} */
  const bullets = [];

  if (isForecast) {
    bullets.push("선택한 기간은 컨센서스·예상치로, 확정 실적과 차이가 있을 수 있습니다.");
  }

  if (priorLabel) {
    const rev = findRowMetric(yoyFlat, ["매출", "revenue", "totalrevenue", "sales"]);
    if (rev?.yoyPct != null) {
      bullets.push(
        `매출 관련 지표는 ${priorLabel} 대비 ${fmtYoy(rev.yoyPct)} (${rev.yoyPct >= 0 ? "증가" : "감소"}) 추세입니다.`,
      );
    }
    const op = findRowMetric(yoyFlat, ["영업이익", "operatingincome", "operating"]);
    if (op?.yoyPct != null) {
      bullets.push(
        `영업이익은 전년 동기 대비 ${fmtYoy(op.yoyPct)}로, ${Math.abs(op.yoyPct) >= 20 ? "변동폭이 큰 편" : "완만한 변화"}입니다.`,
      );
    }
    const ni = findRowMetric(yoyFlat, ["당기순이익", "순이익", "netincome"]);
    if (ni?.yoyPct != null) {
      bullets.push(`당기순이익 전년 대비 ${fmtYoy(ni.yoyPct)}입니다.`);
    }
  } else {
    bullets.push("전년 동기 재무제표를 찾지 못해 전년 대비 분석은 일부만 표시됩니다.");
  }

  if (fundamentals?.per != null && peerMedians.per != null) {
    const ratio = fundamentals.per / peerMedians.per;
    if (ratio >= 1.25) {
      bullets.push(
        `PER ${fmtNum(fundamentals.per)}배 — ${peerGroup} 중앙값(${fmtNum(peerMedians.per)}배)보다 높아 밸류에이션이 상대적으로 높습니다.`,
      );
    } else if (ratio <= 0.8) {
      bullets.push(
        `PER ${fmtNum(fundamentals.per)}배 — 동종 중앙값(${fmtNum(peerMedians.per)}배)보다 낮아 상대적 저평가 구간으로 해석될 수 있습니다.`,
      );
    } else {
      bullets.push(
        `PER ${fmtNum(fundamentals.per)}배 — ${peerGroup} 중앙값(${fmtNum(peerMedians.per)}배)과 유사한 수준입니다.`,
      );
    }
  }

  if (fundamentals?.pbr != null && peerMedians.pbr != null) {
    const ratio = fundamentals.pbr / peerMedians.pbr;
    if (ratio >= 1.2) {
      bullets.push(`PBR ${fmtNum(fundamentals.pbr)}배 — 동종 대비 자산 대비 주가가 높은 편입니다.`);
    } else if (ratio <= 0.85) {
      bullets.push(`PBR ${fmtNum(fundamentals.pbr)}배 — 동종 대비 낮은 순자산 밸류에이션입니다.`);
    }
  }

  if (fundamentals?.roe != null && peerMedians.roe != null) {
    const roePct = fundamentals.roe * 100;
    const medPct = peerMedians.roe * 100;
    if (roePct >= medPct * 1.15) {
      bullets.push(`ROE ${fmtNum(roePct, 1)}% — 동종 중앙(${fmtNum(medPct, 1)}%)보다 수익성이 양호합니다.`);
    } else if (roePct <= medPct * 0.85) {
      bullets.push(`ROE ${fmtNum(roePct, 1)}% — 동종 대비 자기자본 수익률이 낮은 편입니다.`);
    }
  }

  if (fundamentals?.profitMargin != null && peerMedians.profitMargin != null) {
    const m = fundamentals.profitMargin * 100;
    const med = peerMedians.profitMargin * 100;
    if (m >= med * 1.15) {
      bullets.push(`순이익률 ${fmtNum(m, 1)}% — 동종 대비 마진이 높습니다.`);
    } else if (m <= med * 0.85) {
      bullets.push(`순이익률 ${fmtNum(m, 1)}% — 동종 대비 마진이 낮습니다.`);
    }
  }

  if (bullets.length <= (isForecast ? 1 : 0)) {
    bullets.push(
      `${peerGroup} 비교 데이터가 제한적입니다. PER·PBR·ROE와 주요 손익 항목을 함께 보시길 권장합니다.`,
    );
  }

  const summary = `${name} — ${peerGroup} 대비 재무·밸류에이션 요약 (${priorLabel ? `${priorLabel} 대비` : "스냅샷"} 기준)`;

  return {
    summary,
    bullets: bullets.slice(0, 8),
    peerGroup,
    disclaimer:
      "AI 의견은 공개 재무 데이터·동종 중앙값 기반 자동 분석이며 투자 권유가 아닙니다.",
  };
}

/**
 * @param {string} symbol
 * @param {string} periodId
 */
export async function loadFinancialStatementAnalysis(symbol, periodId) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const pid = String(periodId ?? "").trim();

  const [periodsPayload, detail, fundamentals] = await Promise.all([
    loadFinancialPeriods(sym),
    loadFinancialStatementDetail(sym, pid),
    loadStockFundamentals(sym).catch(() => null),
  ]);

  const extracted = extractPeriodMetricsFromDetail(detail, {
    currency: periodsPayload?.currency ?? "KRW",
    market: periodsPayload?.market === "us" ? "us" : "kr",
  });

  const periods = Array.isArray(periodsPayload?.periods) ? periodsPayload.periods : [];
  const currentPeriod = periods.find((p) => p.id === pid) ?? {
    id: pid,
    kind: detail.kind,
    endDateMs: null,
    isForecast: detail.isForecast,
  };

  let periodMetrics = await buildHistoricalPeriodMetrics(
    sym,
    currentPeriod,
    extracted,
    detail,
  );

  const latestPeriodId = periods[0]?.id ?? null;
  if (latestPeriodId === pid && fundamentals) {
    periodMetrics = {
      ...periodMetrics,
      forwardPer: fundamentals.forwardPer ?? null,
      forwardEps: fundamentals.forwardEps ?? null,
    };
  }

  /** 스냅샷 PER·PBR 등 — 선택 기간 기준 */
  const metricsForOpinion = {
    per: periodMetrics.per,
    pbr: periodMetrics.pbr,
    roe: periodMetrics.roe,
    profitMargin: periodMetrics.profitMargin,
  };

  const priorPeriod = findPriorPeriod(periods, currentPeriod);
  let priorDetail = null;
  if (priorPeriod?.id) {
    try {
      priorDetail = await loadFinancialStatementDetail(sym, priorPeriod.id);
    } catch {
      priorDetail = null;
    }
  }

  const sections = mergeYoySections(detail.sections, priorDetail?.sections ?? null);
  const yoyFlat = sections.flatMap((s) =>
    (s.rows ?? []).map((r) => ({ label: r.label, yoyPct: r.yoyPct })),
  );

  const { peerGroup, peers } = loadPeerGroup(sym);
  const peerFundamentals = await Promise.all(
    peers.slice(0, 5).map((p) => loadStockFundamentals(p).catch(() => null)),
  );
  const peerMedians = {
    per: median(peerFundamentals.map((f) => f?.per ?? null).filter((v) => v != null)),
    pbr: median(peerFundamentals.map((f) => f?.pbr ?? null).filter((v) => v != null)),
    roe: median(peerFundamentals.map((f) => f?.roe ?? null).filter((v) => v != null)),
    profitMargin: median(
      peerFundamentals.map((f) => f?.profitMargin ?? null).filter((v) => v != null),
    ),
  };

  const aiOpinion = buildAiOpinion({
    name: periodsPayload?.name ?? sym,
    peerGroup,
    fundamentals: metricsForOpinion,
    peerMedians,
    yoyFlat: sections.flatMap((s) => s.rows ?? []),
    priorLabel: priorPeriod?.label ?? priorDetail?.label ?? null,
    isForecast: Boolean(detail.isForecast),
  });

  return {
    ...detail,
    sections,
    priorPeriodId: priorPeriod?.id ?? null,
    priorPeriodLabel: priorPeriod?.label ?? priorDetail?.label ?? null,
    periodMetrics,
    aiOpinion,
    updatedAt: Date.now(),
  };
}
