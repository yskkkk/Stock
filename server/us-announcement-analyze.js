/**
 * 발표 카드 — 전년/컨센 대비 수치 + 분석 의견
 * (기본: 규칙 기반. OPENAI_API_KEY 있으면 선택 보강)
 */

/** 메트릭 스키마 버전 — 라벨·Beat/Miss 보강 */
export const ANNOUNCEMENT_METRIC_VERSION = 2;

/**
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 * @returns {number | null}
 */
export function pctChange(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
  return Math.round(((x - y) / Math.abs(y)) * 1000) / 10;
}

/**
 * @param {number | null | undefined} n
 * @param {number} [digits]
 */
function fmtEps(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

/**
 * @param {{
 *   kind: string;
 *   title?: string;
 *   symbol?: string;
 *   consensusEps?: number | null;
 *   priorConsensusEps?: number | null;
 *   guidanceEps?: number | null;
 *   trailingEps?: number | null;
 *   quarterConsensusEps?: number | null;
 *   yearAgoEps?: number | null;
 *   reportedEps?: number | null;
 *   reportedConsensusEps?: number | null;
 *   yoyPct?: number | null;
 *   vsConsensusPct?: number | null;
 *   consensusChangePct?: number | null;
 *   vsConsensusLabel?: string | null;
 *   yoyLabel?: string | null;
 *   consensusChangeLabel?: string | null;
 *   period?: string | null;
 *   numAnalysts?: number | null;
 * }} input
 */
export function buildAnnouncementMetrics(input) {
  const kind = String(input.kind ?? "");
  const consensusEps =
    input.consensusEps != null && Number.isFinite(Number(input.consensusEps))
      ? Number(input.consensusEps)
      : null;
  const priorConsensusEps =
    input.priorConsensusEps != null && Number.isFinite(Number(input.priorConsensusEps))
      ? Number(input.priorConsensusEps)
      : null;
  const guidanceEps =
    input.guidanceEps != null && Number.isFinite(Number(input.guidanceEps))
      ? Number(input.guidanceEps)
      : null;
  const trailingEps =
    input.trailingEps != null && Number.isFinite(Number(input.trailingEps))
      ? Number(input.trailingEps)
      : null;
  const quarterConsensusEps =
    input.quarterConsensusEps != null &&
    Number.isFinite(Number(input.quarterConsensusEps))
      ? Number(input.quarterConsensusEps)
      : null;
  const yearAgoEps =
    input.yearAgoEps != null && Number.isFinite(Number(input.yearAgoEps))
      ? Number(input.yearAgoEps)
      : null;
  const reportedEps =
    input.reportedEps != null && Number.isFinite(Number(input.reportedEps))
      ? Number(input.reportedEps)
      : null;
  const reportedConsensusEps =
    input.reportedConsensusEps != null &&
    Number.isFinite(Number(input.reportedConsensusEps))
      ? Number(input.reportedConsensusEps)
      : null;

  const hasExplicitVs = Object.prototype.hasOwnProperty.call(
    input,
    "vsConsensusPct",
  );
  const hasExplicitYoy = Object.prototype.hasOwnProperty.call(input, "yoyPct");
  const hasExplicitChg = Object.prototype.hasOwnProperty.call(
    input,
    "consensusChangePct",
  );

  const vsConsensusPct = hasExplicitVs
    ? input.vsConsensusPct != null && Number.isFinite(Number(input.vsConsensusPct))
      ? Number(input.vsConsensusPct)
      : null
    : guidanceEps != null && consensusEps != null
      ? pctChange(guidanceEps, consensusEps)
      : null;

  // earnings는 Yahoo 스냅 경로에서만 YoY를 넣고, 포워드÷트레일링 암시 비교는 하지 않음
  const yoyPct = hasExplicitYoy
    ? input.yoyPct != null && Number.isFinite(Number(input.yoyPct))
      ? Number(input.yoyPct)
      : null
    : kind === "earnings"
      ? null
      : guidanceEps != null && trailingEps != null
        ? pctChange(guidanceEps, trailingEps)
        : consensusEps != null && trailingEps != null
          ? pctChange(consensusEps, trailingEps)
          : null;

  const consensusChangePct = hasExplicitChg
    ? input.consensusChangePct != null &&
      Number.isFinite(Number(input.consensusChangePct))
      ? Number(input.consensusChangePct)
      : null
    : consensusEps != null && priorConsensusEps != null
      ? pctChange(consensusEps, priorConsensusEps)
      : null;

  /** @type {string | null} */
  let vsConsensusLabel =
    input.vsConsensusLabel != null ? String(input.vsConsensusLabel) : null;
  /** @type {string | null} */
  let yoyLabel = input.yoyLabel != null ? String(input.yoyLabel) : null;
  /** @type {string | null} */
  let consensusChangeLabel =
    input.consensusChangeLabel != null
      ? String(input.consensusChangeLabel)
      : null;

  if (!vsConsensusLabel && vsConsensusPct != null) {
    if (guidanceEps != null && consensusEps != null) {
      vsConsensusLabel = `가이던스 EPS(${fmtEps(guidanceEps)}) vs 컨센 EPS(${fmtEps(consensusEps)})`;
    } else if (reportedEps != null && reportedConsensusEps != null) {
      vsConsensusLabel = `최근 확정 EPS(${fmtEps(reportedEps)}) vs 당시 컨센(${fmtEps(reportedConsensusEps)})`;
    }
  }
  if (!yoyLabel && yoyPct != null) {
    if (quarterConsensusEps != null && yearAgoEps != null) {
      yoyLabel = `당분기 컨센 EPS(${fmtEps(quarterConsensusEps)}) vs 전년 동기(${fmtEps(yearAgoEps)})`;
    } else if (guidanceEps != null && trailingEps != null) {
      yoyLabel = `가이던스 EPS(${fmtEps(guidanceEps)}) vs 트레일링 EPS(${fmtEps(trailingEps)})`;
    } else if (consensusEps != null && trailingEps != null && kind !== "earnings") {
      yoyLabel = `포워드 EPS(${fmtEps(consensusEps)}) vs 트레일링 EPS(${fmtEps(trailingEps)}) — 전년 실적 YoY 아님`;
    }
  }
  if (!consensusChangeLabel && consensusChangePct != null) {
    consensusChangeLabel = `컨센 EPS 직전(${fmtEps(priorConsensusEps)}) → 현재(${fmtEps(consensusEps)})`;
  }

  return {
    metricVersion: ANNOUNCEMENT_METRIC_VERSION,
    consensusEps,
    priorConsensusEps,
    guidanceEps,
    trailingEps,
    quarterConsensusEps,
    yearAgoEps,
    reportedEps,
    reportedConsensusEps,
    yoyPct,
    vsConsensusPct,
    consensusChangePct,
    vsConsensusLabel,
    yoyLabel,
    consensusChangeLabel,
    period: input.period ?? null,
    numAnalysts:
      input.numAnalysts != null && Number.isFinite(Number(input.numAnalysts))
        ? Number(input.numAnalysts)
        : null,
  };
}

/**
 * @param {number | null} pct
 */
function fmtPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * 규칙 기반 의견 (AI 레이어 대체·폴백) — 숫자의 의미까지 명시
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   title?: string;
 *   form?: string | null;
 *   metrics: ReturnType<typeof buildAnnouncementMetrics>;
 * }} args
 */
export function buildAnnouncementAiSummary(args) {
  const { kind, symbol, title, form, metrics } = args;
  const parts = [];
  const vs = fmtPct(metrics.vsConsensusPct);
  const yoy = fmtPct(metrics.yoyPct);
  const chg = fmtPct(metrics.consensusChangePct);

  if (kind === "guidance") {
    if (vs && metrics.vsConsensusLabel) {
      if ((metrics.vsConsensusPct ?? 0) < -3) {
        parts.push(
          `${symbol} 가이던스가 컨센보다 보수적입니다. ${metrics.vsConsensusLabel}: ${vs}. 이후 컨센 하향·배수 재평가 압력을 염두에 두세요.`,
        );
      } else if ((metrics.vsConsensusPct ?? 0) > 3) {
        parts.push(
          `${symbol} 가이던스가 컨센보다 낙관적입니다. ${metrics.vsConsensusLabel}: ${vs}. 컨센 상향 여지와 기대 과열 여부를 함께 보세요.`,
        );
      } else {
        parts.push(
          `${symbol} 가이던스가 컨센과 대체로 일치합니다. ${metrics.vsConsensusLabel}: ${vs}.`,
        );
      }
    } else if (vs) {
      parts.push(`${symbol} 가이던스 대비 컨센 괴리 ${vs}.`);
    } else {
      parts.push(
        `${symbol} 가이던스·전망 관련 공시입니다. 원문에서 매출·EPS 레인지(하한~상한)와 애널 컨센 중앙값을 대조하세요.`,
      );
    }
    if (yoy && metrics.yoyLabel) {
      parts.push(`${metrics.yoyLabel}: ${yoy}.`);
    } else if (yoy) {
      parts.push(`성장 감각 ${yoy}.`);
    }
    parts.push(
      "가이던스가 매출·영업이익·EPS 중 어디에 해당하는지, 일회성 제외 여부도 원문에서 확인하세요.",
    );
  } else if (kind === "consensus") {
    if (chg && metrics.consensusChangeLabel) {
      if ((metrics.consensusChangePct ?? 0) < -2) {
        parts.push(
          `${symbol} 애널 컨센이 하향되었습니다. ${metrics.consensusChangeLabel}: ${chg}. 실적·가이던스 악화 반영 가능성이 큽니다.`,
        );
      } else if ((metrics.consensusChangePct ?? 0) > 2) {
        parts.push(
          `${symbol} 애널 컨센이 상향되었습니다. ${metrics.consensusChangeLabel}: ${chg}. 모멘텀은 긍정이나 이미 주가에 반영됐는지 점검하세요.`,
        );
      } else {
        parts.push(
          `${symbol} 컨센 변동은 소폭입니다. ${metrics.consensusChangeLabel}: ${chg}.`,
        );
      }
    } else if (chg) {
      parts.push(`${symbol} 컨센 변동 ${chg}.`);
    } else {
      parts.push(
        `${symbol} 컨센서스 스냅샷이 갱신되었습니다. 직전 저장분과 비교할 수치가 없어 「컨센 변동」은 비어 있을 수 있습니다.`,
      );
    }
    if (yoy && metrics.yoyLabel) parts.push(`${metrics.yoyLabel}: ${yoy}.`);
    if (metrics.numAnalysts != null) {
      parts.push(`추정에 참여한 애널 수(참고): ${metrics.numAnalysts}명.`);
    }
  } else if (kind === "governance") {
    parts.push(
      `${symbol} 거버넌스·주주 관련 공시(${title || form || "Proxy/8-K"})입니다.`,
    );
    parts.push(
      "배당·자사주·이사회·희석·주주제안 여부를 원문에서 확인하세요. 컨센·전년 EPS 지표는 이 유형과 직접 관련 없을 수 있습니다.",
    );
  } else {
    // earnings (10-Q / 10-K 등)
    const formHint = form ? ` (${form})` : "";
    parts.push(
      `${symbol} 실적·정기보고서${formHint} 이벤트입니다. 아래 수치는 Yahoo Finance 컨센·실적 히스토리 기준이며, 공시 원문 GAAP/Non-GAAP과 다를 수 있습니다.`,
    );
    if (vs && metrics.vsConsensusLabel) {
      const tone =
        (metrics.vsConsensusPct ?? 0) > 1
          ? "컨센을 상회(Beat)한 최근 확정 실적입니다."
          : (metrics.vsConsensusPct ?? 0) < -1
            ? "컨센을 하회(Miss)한 최근 확정 실적입니다."
            : "최근 확정 실적이 컨센과 대체로 비슷합니다.";
      parts.push(`${tone} ${metrics.vsConsensusLabel}: ${vs}.`);
    } else {
      parts.push(
        "「컨센 대비」는 Yahoo에 최근 확정 분기의 실제 EPS·당시 컨센이 있을 때 Beat/Miss로 채웁니다. 없으면 — 이며, 이번 10-Q 숫자를 Analysis 컨센과 직접 맞춰 보세요.",
      );
    }
    if (yoy && metrics.yoyLabel) {
      parts.push(
        `「전년 대비」의미: ${metrics.yoyLabel} → ${yoy}. (매출·영업이익 YoY가 아니라 EPS 기준일 수 있음)`,
      );
    } else {
      parts.push(
        "「전년 대비」는 당분기 컨센 EPS vs 전년 동기 EPS(또는 Yahoo 성장률)로 계산합니다. 없으면 — 입니다.",
      );
    }
    if (chg && metrics.consensusChangeLabel) {
      parts.push(`「컨센 변동」: ${metrics.consensusChangeLabel} → ${chg}.`);
    } else {
      parts.push(
        "「컨센 변동」은 서버가 예전에 저장한 애널 컨센 스냅샷이 있을 때만 표시됩니다. 첫 스캔이면 비어 있을 수 있습니다.",
      );
    }
    parts.push(
      "원문에서는 매출·영업이익·순이익(또는 희석 EPS), 세그먼트, 현금흐름, MD&A의 전망 톤을 확인하고 Yahoo·IR 가이던스와 교차 검증하세요.",
    );
  }

  if (parts.length < 2) {
    parts.push(
      "숫자는 서버·Yahoo 계산값이며, 최종 판단은 EDGAR·IR 원문을 우선하세요.",
    );
  }

  return parts.slice(0, 6).join(" ");
}

/**
 * @param {Parameters<typeof buildAnnouncementAiSummary>[0]} args
 */
export async function generateAnnouncementAiSummary(args) {
  const fallback = buildAnnouncementAiSummary(args);
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) {
    return { summary: fallback, engine: "rules" };
  }
  try {
    const prompt = `You are a Korean equity analyst. Write 4-5 short Korean sentences. Explain what each metric means (vs consensus / YoY / consensus change) using only given numbers and labels. Do not invent numbers.
Symbol: ${args.symbol}
Kind: ${args.kind}
Form: ${args.form || ""}
Title: ${args.title || ""}
Metrics: ${JSON.stringify(args.metrics)}
Draft to refine (keep facts, may expand clarity): ${fallback}`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ?? "gpt-4o-mini").trim(),
        temperature: 0.3,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content:
              "Reply only in Korean, 4-5 sentences. Clarify metric definitions. No invented numbers.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { summary: fallback, engine: "rules" };
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return { summary: fallback, engine: "rules" };
    return { summary: text, engine: "openai" };
  } catch {
    return { summary: fallback, engine: "rules" };
  }
}
