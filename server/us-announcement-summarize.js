/**
 * EDGAR/링크 본문 → 발표 요지·수치·AI 해석 (규칙 + optional OpenAI)
 */
import { fetchEdgarFilingPlainText } from "./us-announcement-filing-text.js";

/** 카드 링크 분석 스키마 버전 */
export const ANNOUNCEMENT_ANALYSIS_VERSION = 4;

/**
 * @param {number | null | undefined} pct
 */
function fmtPct(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const n = Number(pct);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/**
 * @param {number | null | undefined} n
 * @param {number} [d]
 */
function fmtNum(n, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Number(n).toFixed(d);
}

/**
 * 공시 평문에서 자주 쓰는 수치 패턴 추출
 * @param {string} text
 * @returns {string[]}
 */
export function extractFilingNumberLines(text) {
  const body = String(text ?? "").replace(/\s+/g, " ");
  if (!body) return [];
  /** @type {string[]} */
  const hits = [];
  const patterns = [
    {
      re: /(?:diluted\s+)?(?:net\s+)?(?:income|earnings)\s+(?:per\s+(?:common\s+)?share|EPS)[^.]{0,40}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "희석/주당이익(EPS)",
    },
    {
      re: /(?:basic|diluted)\s+EPS[^.]{0,30}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "EPS",
    },
    {
      re: /(?:total\s+)?revenues?(?:\s+was|\s+were|\s+of|:)?[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
      label: "매출",
    },
    {
      re: /operating\s+(?:income|profit)[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
      label: "영업이익",
    },
    {
      re: /net\s+income[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
      label: "순이익",
    },
    {
      re: /(?:full[- ]year|FY\s*\d{2,4}|fiscal\s+year)[^.]{0,80}?(?:EPS|earnings per share|revenue)[^.]{0,60}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "연간 가이던스 수치",
    },
    {
      re: /(?:expects?|guides?|outlook)[^.]{0,100}?\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:to|-|–)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "가이던스 레인지",
    },
  ];

  for (const { re, label } of patterns) {
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(body)) && guard < 3) {
      guard += 1;
      const unit = m[2] ? ` ${m[2]}` : "";
      const range = m[3] ? `–${m[3]}` : "";
      const val = `${m[1]}${range}${unit}`.trim();
      const line = `${label} ${val}`.slice(0, 120);
      if (!hits.includes(line)) hits.push(line);
    }
  }
  return hits.slice(0, 6);
}

/**
 * @param {string} form
 * @param {string} kind
 * @param {string} title
 * @param {string} text
 */
export function buildAboutFromFiling(form, kind, title, text) {
  const f = String(form ?? "").toUpperCase();
  const k = String(kind ?? "");
  const t = String(title ?? "").trim();
  const body = String(text ?? "").trim();
  const lower = body.toLowerCase();

  if (k === "consensus") {
    return `${t || "애널리스트 컨센서스"} 변경 이벤트입니다. Yahoo Analysis 추정치 스냅샷을 기준으로 직전 대비 움직임을 카드에 표시합니다.`;
  }
  if (k === "governance" || /DEF\s*14/i.test(f)) {
    if (/compensation|executive|pay/i.test(body)) {
      return "임원 보상·주주총회(Proxy) 관련 공시입니다. 보수·이사회·주주제안 안건을 다룹니다.";
    }
    return "주주총회·지배구조(Proxy) 공시입니다. 이사회·의결권·주주제안 등 거버넌스 안건이 핵심입니다.";
  }
  if (k === "guidance" || f.startsWith("8-K")) {
    const hasGuidance =
      /guidance|outlook|expects|full[- ]year|fiscal year/i.test(body) ||
      /item\s*2\.02|item\s*7\.01|item\s*8\.01/i.test(body);
    const hasEarn =
      /results of operations|earnings|quarterly results|item\s*2\.02/i.test(body);
    if (hasGuidance && hasEarn) {
      return "실적(Results)과 가이던스·아웃룩을 함께 업데이트한 8-K입니다. 확정 숫자와 향후 전망을 한 번에 봅니다.";
    }
    if (hasGuidance) {
      return "경영진 가이던스·아웃룩을 담은 8-K입니다. 매출·EPS 레인지와 전제(환율·수요 등)가 핵심입니다.";
    }
    if (hasEarn) {
      return "분기/연간 실적(Results of Operations) 관련 8-K입니다. 잠정·확정 실적 숫자를 공시합니다.";
    }
    const item = body.match(/Item\s+(\d+\.\d+)/i);
    return item
      ? `중요 사건(8-K) 공시입니다. 주요 항목 Item ${item[1]}을 확인하세요.`
      : t && t !== "8-K"
        ? `중요 사건(8-K): ${t.slice(0, 100)}`
        : "중요 사건(8-K) 공시입니다. 원문 Item을 확인하세요.";
  }
  if (k === "earnings" || /^10-[QK]/.test(f)) {
    if (f.startsWith("10-K")) {
      return "연간 보고서(10-K) 제출입니다. 연간 재무제표·MD&A·리스크·거버넌스 요약이 포함됩니다.";
    }
    return "분기 보고서(10-Q) 제출입니다. 분기 재무제표·MD&A·주석이 포함되며, 잠정 실적 8-K 이후 확정 숫자가 정리됩니다.";
  }
  if (body) {
    const snip = body.slice(0, 160).replace(/\s+/g, " ");
    return `기업 공시입니다. 원문 요지: ${snip}${body.length > 160 ? "…" : ""}`;
  }
  return t ? `발표: ${t.slice(0, 120)}` : "기업 공시 이벤트입니다.";
}

/**
 * Yahoo 메트릭 + 공시 추출 수치 → 한 블록
 * @param {Record<string, unknown> | null | undefined} metrics
 * @param {string[]} filingLines
 */
export function buildNumbersBrief(metrics, filingLines) {
  /** @type {string[]} */
  const parts = [];
  const m = metrics && typeof metrics === "object" ? metrics : null;
  if (m) {
    const vs = fmtPct(/** @type {number|null} */ (m.vsConsensusPct));
    const yoy = fmtPct(/** @type {number|null} */ (m.yoyPct));
    const chg = fmtPct(/** @type {number|null} */ (m.consensusChangePct));
    if (m.vsConsensusLabel && vs) {
      parts.push(`컨센 대비 ${vs} — ${m.vsConsensusLabel}`);
    } else if (vs) {
      parts.push(`컨센 대비 ${vs}`);
    }
    if (m.yoyLabel && yoy) {
      parts.push(`전년 대비 ${yoy} — ${m.yoyLabel}`);
    } else if (yoy) {
      parts.push(`전년 대비 ${yoy}`);
    }
    if (m.consensusChangeLabel && chg) {
      parts.push(`컨센 변동 ${chg} — ${m.consensusChangeLabel}`);
    } else if (chg) {
      parts.push(`컨센 변동 ${chg}`);
    }
    const q = fmtNum(/** @type {number|null} */ (m.quarterConsensusEps));
    const rep = fmtNum(/** @type {number|null} */ (m.reportedEps));
    const trail = fmtNum(/** @type {number|null} */ (m.trailingEps));
    const fwd = fmtNum(/** @type {number|null} */ (m.consensusEps));
    if (rep) parts.push(`Yahoo 최근 확정 EPS ${rep}`);
    if (q) parts.push(`당분기 컨센 EPS ${q}`);
    if (fwd) parts.push(`포워드 EPS ${fwd}`);
    if (trail) parts.push(`트레일링 EPS ${trail}`);
    if (m.numAnalysts != null) parts.push(`애널 수 ${m.numAnalysts}`);
  }
  for (const line of filingLines) {
    if (!parts.some((p) => p.includes(line.slice(0, 24)))) {
      parts.push(`공시 본문: ${line}`);
    }
  }
  if (!parts.length) {
    return "링크·Yahoo에서 바로 뽑을 핵심 수치가 부족합니다. EDGAR 원문과 Yahoo Analysis를 함께 확인하세요.";
  }
  return parts.slice(0, 8).join("\n");
}

/**
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   form?: string | null;
 *   title?: string;
 *   about: string;
 *   numbersBrief: string;
 *   metrics?: Record<string, unknown> | null;
 *   filingLines?: string[];
 *   hasFilingText?: boolean;
 * }} args
 */
export function buildInterpretationFromBrief(args) {
  const { kind, form, hasFilingText } = args;
  /** @type {string[]} */
  const paras = [];

  if (kind === "earnings") {
    paras.push(
      "정기보고서 숫자는 GAAP/Non-GAAP·일회성 여부에 따라 Yahoo 컨센과 어긋날 수 있습니다.",
    );
    paras.push(
      "Beat/Miss·전년 동기·가이던스 톤을 함께 보고, 세그먼트·현금흐름까지 원문에서 확인하세요.",
    );
  } else if (kind === "guidance") {
    paras.push(
      "가이던스가 컨센보다 보수/낙관이면 이후 컨센 조정·배수 재평가 재료가 됩니다.",
    );
    paras.push("레인지 중앙값과 전제 가정을 원문에서 확인하세요.");
  } else if (kind === "consensus") {
    paras.push(
      "애널 컨센 이동은 실적·가이던스·매크로 반영일 수 있습니다.",
    );
    paras.push("이미 주가에 선반영됐는지 Analysis·차트와 함께 보세요.");
  } else if (kind === "governance") {
    paras.push(
      "배당·자사주·희석·이사회 변화가 자본배분·지배구조에 미치는 영향을 원문 안건 기준으로 판단하세요.",
    );
  } else {
    paras.push("공시 내용과 카드 상단 수치를 함께 보고 원문으로 교차 확인하세요.");
  }

  if (hasFilingText) {
    paras.push(
      `근거: EDGAR${form ? ` (${form})` : ""} 본문 + Yahoo 메트릭`,
    );
  } else {
    paras.push("근거: Yahoo 메트릭·양식 메타 (공시 본문 미수집 — 링크 원문 확인)");
  }

  return paras.join("\n\n").slice(0, 1200);
}

/**
 * @param {string} form
 * @param {string} kind
 * @param {string} title
 * @param {string} text
 * @param {Record<string, unknown> | null | undefined} [metrics]
 */
export function buildFilingHeadlineAndDetail(form, kind, title, text, metrics) {
  const about = buildAboutFromFiling(form, kind, title, text);
  const filingLines = extractFilingNumberLines(text);
  const numbersBrief = buildNumbersBrief(metrics, filingLines);
  const interpretation = buildInterpretationFromBrief({
    kind,
    symbol: "",
    form,
    title,
    about,
    numbersBrief,
    filingLines,
    hasFilingText: Boolean(String(text ?? "").trim()),
  });

  /** @type {string} */
  let headline = "";
  const f = String(form ?? "").toUpperCase();
  const k = String(kind ?? "");
  if (k === "earnings" || /^10-[QK]/.test(f)) {
    headline = f.startsWith("10-K")
      ? "연간 보고서(10-K) 제출"
      : "분기 보고서(10-Q) 제출";
  } else if (k === "guidance" || f.startsWith("8-K")) {
    headline = about.includes("가이던스")
      ? "가이던스·아웃룩 8-K"
      : about.includes("실적")
        ? "실적 관련 8-K"
        : "중요 사건(8-K) 공시";
  } else if (k === "governance") {
    headline = "거버넌스·Proxy 공시";
  } else if (k === "consensus") {
    headline = String(title ?? "컨센서스 변경").slice(0, 80);
  } else {
    headline = String(title ?? "기업 공시").slice(0, 80);
  }

  return {
    headline: headline.slice(0, 120),
    about: about.slice(0, 500),
    numbersBrief: numbersBrief.slice(0, 900),
    interpretation: interpretation.slice(0, 1600),
    detail: `${about} ${numbersBrief}`.slice(0, 1400),
  };
}

/**
 * @param {{
 *   form?: string | null;
 *   kind: string;
 *   title?: string;
 *   symbol?: string;
 *   edgarUrl?: string | null;
 *   yahooUrl?: string | null;
 *   metrics?: Record<string, unknown>;
 * }} cardLike
 */
export async function enrichAnnouncementCopy(cardLike) {
  const form = cardLike.form ?? null;
  const kind = String(cardLike.kind ?? "");
  const title = String(cardLike.title ?? "");
  const symbol = String(cardLike.symbol ?? "").toUpperCase();
  let text = "";
  let filingFetchOk = false;

  if (cardLike.edgarUrl) {
    const fetched = await fetchEdgarFilingPlainText(cardLike.edgarUrl, {
      maxChars: 24_000,
    });
    if (fetched.ok) {
      text = fetched.text;
      filingFetchOk = true;
    }
  }

  let { headline, about, numbersBrief, interpretation, detail } =
    buildFilingHeadlineAndDetail(form ?? "", kind, title, text, cardLike.metrics);

  interpretation = buildInterpretationFromBrief({
    kind,
    symbol: symbol || "—",
    form,
    title,
    about,
    numbersBrief,
    hasFilingText: filingFetchOk,
  });

  if (kind === "consensus" && cardLike.metrics) {
    const chg = Number(cardLike.metrics.consensusChangePct);
    if (Number.isFinite(chg)) {
      headline = `${symbol} 컨센 ${chg >= 0 ? "상향" : "하향"} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`.trim();
      about = `${symbol} 애널리스트 합의 EPS가 직전 스냅샷 대비 ${chg >= 0 ? "상향" : "하향"}된 이벤트입니다. Yahoo Analysis 링크의 기간별 추정치를 함께 보세요.`;
    }
  }

  let engine = filingFetchOk ? "edgar+rules" : "metrics+rules";
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (key && (text || cardLike.metrics)) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: String(
            process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ?? "gpt-4o-mini",
          ).trim(),
          temperature: 0.2,
          max_tokens: 650,
          messages: [
            {
              role: "system",
              content:
                'Reply in Korean JSON only: {"headline":"<=40 chars","about":"1-2 short sentences what this filing is","numbers":"one bullet per line (use \\n), key figures only","interpretation":"2-4 short sentences separated by \\n\\n; do NOT repeat about or numbers"}. Do not invent numbers not present in metrics or text.',
            },
            {
              role: "user",
              content: `Symbol ${symbol} form ${form} kind ${kind} title ${title}
Yahoo/metrics JSON: ${JSON.stringify(cardLike.metrics || {})}
Draft about: ${about}
Draft numbers (prefer keep as lines): ${numbersBrief}
Draft interpretation (interpretation only): ${interpretation}
EDGAR/link text (may be empty):
${text.slice(0, 9000)}
Yahoo link (context only): ${cardLike.yahooUrl || ""}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(35_000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = String(data?.choices?.[0]?.message?.content ?? "").trim();
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed.headline) headline = String(parsed.headline).slice(0, 120);
          if (parsed.about) about = String(parsed.about).slice(0, 700);
          if (parsed.numbers) numbersBrief = String(parsed.numbers).slice(0, 900);
          if (parsed.interpretation) {
            interpretation = String(parsed.interpretation).slice(0, 1600);
          }
          detail = `${about} ${numbersBrief}`.slice(0, 1400);
          engine = filingFetchOk ? "edgar+openai" : "metrics+openai";
        }
      }
    } catch {
      /* keep rules */
    }
  }

  return {
    headline,
    about,
    numbersBrief,
    interpretation,
    detail,
    analysisVersion: ANNOUNCEMENT_ANALYSIS_VERSION,
    analysisEngine: engine,
    filingTextChars: text.length,
    enrichedAt: Date.now(),
  };
}
