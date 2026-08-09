/**
 * 발표 카드 — 전년/컨센 대비 수치 + 짧은 분석 의견
 * (기본: 규칙 기반. OPENAI_API_KEY 있으면 선택 보강)
 */
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
 * @param {{
 *   kind: string;
 *   title?: string;
 *   symbol?: string;
 *   consensusEps?: number | null;
 *   priorConsensusEps?: number | null;
 *   guidanceEps?: number | null;
 *   trailingEps?: number | null;
 *   yoyPct?: number | null;
 *   vsConsensusPct?: number | null;
 *   consensusChangePct?: number | null;
 *   period?: string | null;
 * }} input
 */
export function buildAnnouncementMetrics(input) {
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

  const vsConsensusPct =
    input.vsConsensusPct != null && Number.isFinite(Number(input.vsConsensusPct))
      ? Number(input.vsConsensusPct)
      : guidanceEps != null && consensusEps != null
        ? pctChange(guidanceEps, consensusEps)
        : null;

  const yoyPct =
    input.yoyPct != null && Number.isFinite(Number(input.yoyPct))
      ? Number(input.yoyPct)
      : guidanceEps != null && trailingEps != null
        ? pctChange(guidanceEps, trailingEps)
        : consensusEps != null && trailingEps != null
          ? pctChange(consensusEps, trailingEps)
          : null;

  const consensusChangePct =
    input.consensusChangePct != null && Number.isFinite(Number(input.consensusChangePct))
      ? Number(input.consensusChangePct)
      : consensusEps != null && priorConsensusEps != null
        ? pctChange(consensusEps, priorConsensusEps)
        : null;

  return {
    consensusEps,
    priorConsensusEps,
    guidanceEps,
    trailingEps,
    yoyPct,
    vsConsensusPct,
    consensusChangePct,
    period: input.period ?? null,
    numAnalysts: null,
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
 * 규칙 기반 짧은 의견 (AI 레이어 대체·폴백)
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   title?: string;
 *   metrics: ReturnType<typeof buildAnnouncementMetrics>;
 * }} args
 */
export function buildAnnouncementAiSummary(args) {
  const { kind, symbol, title, metrics } = args;
  const parts = [];
  const vs = fmtPct(metrics.vsConsensusPct);
  const yoy = fmtPct(metrics.yoyPct);
  const chg = fmtPct(metrics.consensusChangePct);

  if (kind === "guidance") {
    if (vs) {
      if ((metrics.vsConsensusPct ?? 0) < -3) {
        parts.push(
          `${symbol} 가이던스가 컨센(${metrics.consensusEps ?? "—"}) 대비 ${vs}로 보수적입니다. 이후 컨센 하향·배수 재평가 압력을 염두에 두세요.`,
        );
      } else if ((metrics.vsConsensusPct ?? 0) > 3) {
        parts.push(
          `${symbol} 가이던스가 컨센 대비 ${vs}로 낙관적입니다. 컨센 상향 여지와 기대 과열 여부를 함께 보세요.`,
        );
      } else {
        parts.push(
          `${symbol} 가이던스가 컨센과 대체로 일치(${vs})합니다. 숫자만으로는 재료가 약할 수 있습니다.`,
        );
      }
    } else {
      parts.push(
        `${symbol} 가이던스·전망 관련 공시입니다. 원문에서 매출·EPS 레인지를 확인하세요.`,
      );
    }
    if (yoy) {
      parts.push(`전년(트레일링) 대비 ${yoy} 수준으로 읽힙니다.`);
    }
  } else if (kind === "consensus") {
    if (chg) {
      if ((metrics.consensusChangePct ?? 0) < -2) {
        parts.push(
          `${symbol} 애널 컨센이 ${chg} 하향되었습니다. 실적·가이던스 악화 반영 가능성이 큽니다.`,
        );
      } else if ((metrics.consensusChangePct ?? 0) > 2) {
        parts.push(
          `${symbol} 애널 컨센이 ${chg} 상향되었습니다. 모멘텀은 긍정이나 이미 주가에 반영됐는지 점검하세요.`,
        );
      } else {
        parts.push(`${symbol} 컨센 변동은 ${chg}로 소폭입니다.`);
      }
    } else {
      parts.push(`${symbol} 컨센서스 스냅샷이 갱신되었습니다.`);
    }
    if (yoy) parts.push(`포워드 대비 트레일링 성장 감각은 ${yoy}입니다.`);
  } else if (kind === "governance") {
    parts.push(
      `${symbol} 거버넌스·주주 관련 공시(${title || "Proxy/8-K"})입니다. 배당·자사주·이사회·희석 여부를 원문에서 확인하세요.`,
    );
  } else {
    parts.push(
      `${symbol} 실적·공시 이벤트입니다. 컨센 대비 Beat/Miss와 가이던스 톤을 함께 보세요.`,
    );
    if (vs) parts.push(`컨센 대비 ${vs}.`);
    if (yoy) parts.push(`전년 대비 ${yoy}.`);
  }

  if (parts.length < 2) {
    parts.push("숫자는 서버 계산값이며, 최종 판단은 EDGAR·IR 원문을 우선하세요.");
  }

  return parts.slice(0, 3).join(" ");
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
    const prompt = `You are a concise Korean equity analyst. In 2-3 short Korean sentences, comment on this US stock announcement. Do not invent numbers not given.
Symbol: ${args.symbol}
Kind: ${args.kind}
Title: ${args.title || ""}
Metrics: ${JSON.stringify(args.metrics)}
Draft to refine (keep facts): ${fallback}`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ?? "gpt-4o-mini").trim(),
        temperature: 0.3,
        max_tokens: 220,
        messages: [
          { role: "system", content: "Reply only in Korean, max 3 sentences." },
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
