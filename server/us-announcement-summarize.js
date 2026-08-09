/**
 * EDGAR/링크 본문 → 발표 요지·수치·AI 해석 (규칙 + optional OpenAI)
 */
import { fetchEdgarFilingPlainText } from "./us-announcement-filing-text.js";

/** 카드 링크 분석 스키마 버전 (8 = 상세 분석 deepAnalysis + 페이지 뷰) */
export const ANNOUNCEMENT_ANALYSIS_VERSION = 8;

/** 상세 분석 최대 글자 (긴 10-Q 요약용) */
export const DEEP_ANALYSIS_MAX_CHARS = 18_000;

/** UI에서 페이지(전문)로 열 최소 길이 */
export const DEEP_ANALYSIS_PAGE_CHARS = 1_800;

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
 * 공시 본문에서 의미 있는 영문 문장 발췌
 * @param {string} text
 * @param {string} kind
 * @param {number} [limit]
 */
export function pickFilingExcerpts(text, kind, limit = 5) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return [];
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 320)
    .filter(
      (s) =>
        !/^(?:false|true)\b/i.test(s) &&
        !/\b(?:xmlns|xsi:|iso4217|link:|dei:)\b/i.test(s) &&
        !/--\d{2}-\d{2}/.test(s) &&
        !/\bP\d+Y\b/.test(s) &&
        (s.match(/[A-Za-z]{3,}/g) || []).length >= 5,
    );

  const kindBoost =
    kind === "governance"
      ? /compensation|board|director|proposal|meeting|vote|proxy|shareholder/i
      : kind === "guidance"
        ? /guidance|outlook|expect|forecast|revenue|eps|item\s*2\.02|full[- ]year/i
        : kind === "earnings"
          ? /revenue|income|eps|earnings|cash flow|segment|md&a|quarter/i
          : /estimate|consensus|analyst/i;

  /** @type {{ s: string; score: number }[]} */
  const scored = [];
  for (const s of sentences) {
    let score = 0;
    if (kindBoost.test(s)) score += 5;
    if (/\$[\d,.]+|\d+(?:\.\d+)?%|\bEPS\b|\brevenue\b/i.test(s)) score += 3;
    if (/item\s+\d/i.test(s)) score += 2;
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  /** @type {string[]} */
  const out = [];
  for (const row of scored) {
    if (out.some((x) => x.slice(0, 48) === row.s.slice(0, 48))) continue;
    out.push(row.s);
    if (out.length >= limit) break;
  }
  if (!out.length && body.length > 80) {
    out.push(body.slice(0, 220).trim() + (body.length > 220 ? "…" : ""));
  }
  return out;
}

/**
 * 링크 본문 기반 한글 글(전문) — 카드 클릭 상세용
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   form?: string | null;
 *   title?: string;
 *   about: string;
 *   numbersBrief: string;
 *   interpretation: string;
 *   filingText?: string;
 *   hasFilingText?: boolean;
 *   metrics?: Record<string, unknown> | null;
 * }} args
 */
export function buildArticleFromFiling(args) {
  const {
    kind,
    symbol,
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    filingText = "",
    hasFilingText,
  } = args;
  const sym = String(symbol || "").trim() || "해당 종목";
  const excerpts = pickFilingExcerpts(filingText, kind, 5);
  /** @type {string[]} */
  const paras = [];

  paras.push(
    `${sym}의 ${form || title || kind} 공시에 대한 요약입니다. ${about}`,
  );

  if (hasFilingText && excerpts.length) {
    paras.push(
      "EDGAR 원문에서 확인한 핵심 내용(영문 발췌를 바탕으로 정리)은 다음과 같습니다.",
    );
    for (let i = 0; i < excerpts.length; i += 1) {
      paras.push(`(${i + 1}) ${excerpts[i]}`);
    }
    paras.push(
      "위 발췌는 원문 문장을 그대로 옮긴 것이며, 아래 해석은 이를 한글 관점으로 정리한 것입니다.",
    );
  } else if (!hasFilingText) {
    paras.push(
      "이 카드는 EDGAR HTML 본문을 아직 충분히 읽지 못했습니다. 아래는 Yahoo 지표·양식 메타 중심이며, 카드의 EDGAR 링크에서 원문을 반드시 대조하세요.",
    );
  }

  if (numbersBrief && !String(numbersBrief).includes("표시하지 않습니다")) {
    paras.push(`관련 수치 요약: ${String(numbersBrief).replace(/\n/g, "; ")}`);
  } else if (kind === "governance") {
    paras.push(
      "이 공시는 실적 Beat/Miss와 직접 대응되지 않는 거버넌스·Proxy 성격입니다. 보수·이사회·주주제안 등 안건 자체를 중심으로 읽어야 합니다.",
    );
  }

  const interpParas = String(interpretation || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (interpParas.length) {
    paras.push("AI 해석");
    for (const p of interpParas) {
      if (/^근거:/.test(p)) continue;
      paras.push(p);
    }
  }

  paras.push(
    hasFilingText
      ? `근거 자료: EDGAR${form ? ` (${form})` : ""} 본문을 읽어 정리했습니다. 최종 판단은 원문 링크를 우선하세요.`
      : "근거 자료: 링크 본문 미수집 — EDGAR/Yahoo 원문 확인이 필요합니다.",
  );

  return paras.join("\n\n").slice(0, 6000);
}

/**
 * 공시 평문에서 주제별 힌트 문장 수집
 * @param {string} text
 * @param {RegExp} re
 * @param {number} [limit]
 */
function pickTopicSentences(text, re, limit = 3) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return [];
  /** @type {string[]} */
  const out = [];
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 360);
  for (const s of sentences) {
    if (!re.test(s)) continue;
    if (out.some((x) => x.slice(0, 40) === s.slice(0, 40))) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 10-Q/10-K·실적 수준의 긴 한글 상세 분석 (섹션 ## 헤더)
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   form?: string | null;
 *   title?: string;
 *   about: string;
 *   numbersBrief: string;
 *   interpretation: string;
 *   article?: string;
 *   filingText?: string;
 *   hasFilingText?: boolean;
 *   metrics?: Record<string, unknown> | null;
 * }} args
 */
export function buildDeepAnalysisFromFiling(args) {
  const {
    kind,
    symbol,
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    article = "",
    filingText = "",
    hasFilingText,
    metrics,
  } = args;
  const sym = String(symbol || "").trim() || "해당 종목";
  const f = String(form ?? "").toUpperCase();
  const isEarningsDoc =
    kind === "earnings" || /^10-[QK]/.test(f) || /8-K/i.test(f);
  const numberLines = extractFilingNumberLines(filingText);
  const excerpts = pickFilingExcerpts(filingText, kind, isEarningsDoc ? 8 : 5);
  const m = metrics && typeof metrics === "object" ? metrics : null;

  /** @type {string[]} */
  const sections = [];

  sections.push("## 한줄 요약");
  sections.push(
    `${sym} ${f || title || kind} 공시입니다. ${about}${
      hasFilingText
        ? " EDGAR 원문을 바탕으로 핵심 숫자·사업·재무·리스크를 나눠 정리했습니다."
        : " 원문 HTML을 충분히 읽지 못해 Yahoo 지표·메타 중심이며, EDGAR 링크와 대조가 필요합니다."
    }`,
  );

  sections.push("## 핵심 실적·수치");
  /** @type {string[]} */
  const metricBits = [];
  if (m) {
    const vs = fmtPct(/** @type {number|null} */ (m.vsConsensusPct));
    const yoy = fmtPct(/** @type {number|null} */ (m.yoyPct));
    const chg = fmtPct(/** @type {number|null} */ (m.consensusChangePct));
    const rep = fmtNum(/** @type {number|null} */ (m.reportedEps));
    const fwd = fmtNum(/** @type {number|null} */ (m.consensusEps));
    if (rep) metricBits.push(`Yahoo 최근 확정 EPS ${rep}`);
    if (fwd) metricBits.push(`전방 컨센 EPS ${fwd}`);
    if (vs) metricBits.push(`컨센 대비 ${vs}${m.vsConsensusLabel ? ` (${m.vsConsensusLabel})` : ""}`);
    if (yoy) metricBits.push(`전년 대비 ${yoy}${m.yoyLabel ? ` (${m.yoyLabel})` : ""}`);
    if (chg) metricBits.push(`컨센 변동 ${chg}`);
  }
  if (numberLines.length) {
    sections.push(
      [...metricBits, ...numberLines.map((l) => `공시 추출: ${l}`)].join("\n"),
    );
  } else if (numbersBrief && !String(numbersBrief).includes("표시하지 않습니다")) {
    sections.push(
      [...metricBits, String(numbersBrief).replace(/\n/g, "\n")].filter(Boolean).join("\n") ||
        "수치 요약을 공시에서 충분히 뽑지 못했습니다. 손익계산서·EPS 표를 원문에서 확인하세요.",
    );
  } else {
    sections.push(
      metricBits.length
        ? metricBits.join("\n")
        : "실적 Beat/Miss 수치를 카드 메트릭에서 확보하지 못했습니다. 손익·현금흐름표를 원문에서 확인하세요.",
    );
  }

  sections.push("## 사업·세그먼트 포인트");
  const segHits = pickTopicSentences(
    filingText,
    /(?:Google Cloud|YouTube|Search|segment|subscription|advertising|revenue(?:s)? (?:increased|decreased|were)|operating income)/i,
    4,
  );
  if (segHits.length) {
    sections.push(
      "원문에서 사업·세그먼트 관련으로 눈에 띄는 문장입니다.\n" +
        segHits.map((s, i) => `(${i + 1}) ${s}`).join("\n"),
    );
  } else if (excerpts.length) {
    sections.push(
      "공시 발췌(영문)를 바탕으로 한 사업 포인트입니다.\n" +
        excerpts.slice(0, 5).map((s, i) => `(${i + 1}) ${s}`).join("\n"),
    );
  } else {
    sections.push(
      kind === "governance"
        ? "거버넌스·Proxy 안건(보수·이사회·주주제안 등)을 중심으로 읽으세요. 실적 세그먼트 표는 보통 없습니다."
        : "세그먼트별 매출·영업이익 표가 원문에 있으면 Search/Cloud/광고 비중 변화를 우선 확인하세요.",
    );
  }

  sections.push("## 특이 항목 (기타이익·투자·CapEx·M&A)");
  const specialHits = pickTopicSentences(
    filingText,
    /(?:other income|unrealized|equity securit|SpaceX|Anthropic|capital expenditure|purchases of property|acquisition|goodwill|free cash flow|repurchase|dividend|debt issued|mandatory convertible)/i,
    4,
  );
  if (specialHits.length) {
    sections.push(
      "순이익만 보면 왜곡될 수 있는 항목(평가이익·설비투자·인수·자본조달) 후보입니다.\n" +
        specialHits.map((s, i) => `(${i + 1}) ${s}`).join("\n"),
    );
  } else {
    sections.push(
      isEarningsDoc
        ? "기타이익(투자자산 평가)·CapEx·인수·자사주/배당·부채 발행이 있는지 MD&A·현금흐름표를 확인하세요. 평가이익이 크면 영업이익과 순이익을 분리해서 봐야 합니다."
        : "해당 공시 유형에서는 설비투자·인수 특이사항이 제한적일 수 있습니다. 관련 Item이 있으면 원문에서 확인하세요.",
    );
  }

  sections.push("## 재무상태·현금흐름");
  const bsHits = pickTopicSentences(
    filingText,
    /(?:cash and cash equivalents|total assets|long-term debt|operating activities|investing activities|financing activities|backlog|remaining performance obligation)/i,
    3,
  );
  if (bsHits.length) {
    sections.push(bsHits.map((s, i) => `(${i + 1}) ${s}`).join("\n"));
  } else {
    sections.push(
      "현금·부채·영업/투자/재무 현금흐름, (클라우드라면) 매출 백로그를 대차대조표·현금흐름표에서 확인하세요.",
    );
  }

  sections.push("## 리스크·소송·규제");
  const riskHits = pickTopicSentences(
    filingText,
    /(?:antitrust|Department of Justice|European Commission|litigation|legal proceedings|risk factor|fine|remed(?:y|ies)|regulatory)/i,
    3,
  );
  if (riskHits.length) {
    sections.push(riskHits.map((s, i) => `(${i + 1}) ${s}`).join("\n"));
  } else if (kind === "governance") {
    sections.push(
      "Proxy·거버넌스 공시는 총회 안건·보수 정책·주주제안이 리스크 포인트입니다.",
    );
  } else {
    sections.push(
      "Legal Proceedings·Risk Factors·반독점/벌금 관련 업데이트가 있는지 10-Q/10-K Part II를 확인하세요.",
    );
  }

  sections.push("## 해석·투자 관점");
  const interp = String(interpretation || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^근거:/.test(s));
  if (interp.length) {
    sections.push(interp.join("\n\n"));
  } else if (article) {
    sections.push(String(article).slice(0, 1200));
  } else {
    sections.push(
      "숫자(영업이익·세그먼트)와 일회성/평가이익·CapEx 가이던스를 분리해 읽고, 원문 EDGAR와 컨퍼런스 콜 톤을 함께 보세요.",
    );
  }

  sections.push("## 근거");
  sections.push(
    hasFilingText
      ? `EDGAR${f ? ` (${f})` : ""} 평문 추출·Yahoo 메트릭·규칙 기반 요약을 사용했습니다. 최종 판단은 원문·실적 발표 자료를 우선하세요.`
      : "링크 본문 미수집 — EDGAR/Yahoo 원문 확인이 필요합니다.",
  );

  return sections.join("\n\n").slice(0, DEEP_ANALYSIS_MAX_CHARS);
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
    const isAddl =
      /DEFA14A/i.test(f) ||
      /additional\s+(?:definitive\s+)?proxy/i.test(`${t} ${body}`);
    const formLabel = isAddl
      ? "추가 Proxy 자료(DEFA14A)"
      : /DEF\s*14A/i.test(f) || /DEFINITIVE PROXY/i.test(t)
        ? "정기 Proxy 성명서(DEF 14A)"
        : "거버넌스·Proxy";
    const meeting = body.match(
      /(?:annual meeting|special meeting)[^.]{0,100}?(?:on|to be held)\s+([A-Za-z]+ \d{1,2},?\s+\d{4})/i,
    );
    /** @type {string[]} */
    const topics = [];
    if (/compensation|executive|pay|say.?on.?pay/i.test(body + t)) {
      topics.push("임원 보수");
    }
    if (/director|board|nominee|이사회/i.test(body + t)) topics.push("이사회");
    if (/shareholder proposal|주주제안/i.test(body + t)) topics.push("주주제안");
    if (/buyback|repurchase|dividend|자사주|배당/i.test(body + t)) {
      topics.push("배당·자사주");
    }
    let about = `${formLabel} 공시입니다.`;
    if (isAddl) {
      about +=
        " 본 Proxy(DEF 14A)에 덧붙인 추가 권유·수정 자료로, 정기 성명서와는 제출 목적·시점이 다릅니다.";
    } else {
      about +=
        " 연차/임시 주주총회 안건·이사회·보수를 담은 본문 Proxy입니다.";
    }
    if (meeting?.[1]) about += ` 총회일 언급: ${meeting[1]}.`;
    if (topics.length) about += ` 확인된 주제: ${topics.join("·")}.`;
    else if (t) about += ` 제목: ${t.slice(0, 80)}.`;
    return about;
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
 * @param {string} [kind]
 */
export function buildNumbersBrief(metrics, filingLines, kind = "") {
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
    if (String(kind) === "governance") {
      return "거버넌스·Proxy 공시는 실적 Beat/Miss·컨센 EPS를 표시하지 않습니다. EDGAR 원문의 안건·보수·이사회를 확인하세요.";
    }
    return "링크·Yahoo에서 바로 뽑을 핵심 수치가 부족합니다. EDGAR 원문과 Yahoo Analysis를 함께 확인하세요.";
  }
  return parts.slice(0, 8).join("\n");
}

/**
 * @param {number | null | undefined} pct
 * @param {string} negLabel
 * @param {string} posLabel
 * @param {string} flatLabel
 */
function toneFromPct(pct, negLabel, posLabel, flatLabel) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const n = Number(pct);
  if (n <= -2) return { tone: negLabel, pct: fmtPct(n) };
  if (n >= 2) return { tone: posLabel, pct: fmtPct(n) };
  return { tone: flatLabel, pct: fmtPct(n) };
}

/**
 * 메트릭·공시 추출값으로 직접 해석 (일반론만 쓰지 않음)
 * @param {{
 *   kind: string;
 *   symbol?: string;
 *   form?: string | null;
 *   title?: string;
 *   about?: string;
 *   numbersBrief?: string;
 *   metrics?: Record<string, unknown> | null;
 *   filingLines?: string[];
 *   hasFilingText?: boolean;
 *   filingText?: string;
 * }} args
 */
export function buildInterpretationFromBrief(args) {
  const {
    kind,
    symbol,
    form,
    title,
    metrics,
    filingLines = [],
    hasFilingText,
    filingText = "",
  } = args;
  const m = metrics && typeof metrics === "object" ? metrics : {};
  const sym = String(symbol || "").trim() || "해당 종목";
  const vs = Number(m.vsConsensusPct);
  const yoy = Number(m.yoyPct);
  const chg = Number(m.consensusChangePct);
  const hasVs = Number.isFinite(vs);
  const hasYoy = Number.isFinite(yoy);
  const hasChg = Number.isFinite(chg);
  const body = String(filingText ?? "");
  const lower = body.toLowerCase();

  /** @type {string[]} */
  const paras = [];

  if (kind === "guidance") {
    if (hasVs) {
      const t = toneFromPct(
        vs,
        "보수적(컨센 하회)",
        "낙관적(컨센 상회)",
        "컨센과 대체로 일치",
      );
      paras.push(
        `${sym} 이번 가이던스는 컨센 대비 ${t?.pct}로 ${t?.tone}입니다.` +
          (m.vsConsensusLabel ? ` (${m.vsConsensusLabel})` : ""),
      );
      if (vs <= -3) {
        paras.push(
          "해석: 시장 기대보다 낮은 전망이므로 단기적으로 컨센 하향·배수 축소 압력이 생길 수 있습니다.",
        );
      } else if (vs >= 3) {
        paras.push(
          "해석: 시장 기대보다 높은 전망이므로 컨센 상향 여지는 있으나, 이미 주가에 선반영됐는지 점검이 필요합니다.",
        );
      } else {
        paras.push(
          "해석: 숫자상 서프라이즈가 크지 않아, 가이던스 자체만으로 방향성이 바뀌긴 어렵습니다.",
        );
      }
    } else {
      const raise =
        /raises|increases|above|higher than|raised guidance/i.test(lower);
      const lowerTone =
        /lowers|reduces|below|weak|decline|lowered guidance/i.test(lower);
      if (raise) {
        paras.push(
          `${sym} 공시 문언상 가이던스·전망을 상향(또는 호조)하는 톤입니다.`,
        );
        paras.push(
          "해석: 상향 폭이 컨센을 얼마나 넘는지가 핵심입니다. Yahoo 추정치와 대조해 재료 강도를 가늠하세요.",
        );
      } else if (lowerTone) {
        paras.push(
          `${sym} 공시 문언상 가이던스·전망을 하향(또는 둔화)하는 톤입니다.`,
        );
        paras.push(
          "해석: 하향이면 컨센·목표가 조정 재료가 될 수 있어, 원문 레인지(하한~상한)를 우선 확인하세요.",
        );
      } else if (filingLines.length) {
        paras.push(
          `${sym} 가이던스·실적 공시에서 확인된 수치: ${filingLines.slice(0, 3).join("; ")}.`,
        );
        paras.push(
          "해석: 위 수치를 당분기·연간 컨센과 비교하면 Beat/Miss·가이던스 괴리를 직접 판단할 수 있습니다.",
        );
      } else {
        paras.push(
          `${sym} 가이던스 카드이지만 컨센 대비 %와 공시 EPS/매출 숫자가 아직 비어 있습니다.`,
        );
        paras.push(
          "해석: EDGAR 가이던스 레인지와 Yahoo 컨센 중앙값을 대조하기 전에는 보수/낙관 결론을 단정하기 어렵습니다.",
        );
      }
    }
    if (hasYoy && m.yoyLabel) {
      paras.push(`성장 감각: 전년 관련 ${fmtPct(yoy)} (${m.yoyLabel}).`);
    }
  } else if (kind === "consensus") {
    if (hasChg) {
      const t = toneFromPct(chg, "하향", "상향", "소폭 변동");
      paras.push(
        `${sym} 애널 컨센이 직전 스냅 대비 ${t?.pct} ${t?.tone}되었습니다.` +
          (m.consensusChangeLabel ? ` (${m.consensusChangeLabel})` : ""),
      );
      if (chg <= -2) {
        paras.push(
          "해석: 컨센 하향은 실적·가이던스 악화 또는 매크로 반영 가능성이 큽니다. 추가 하향 여부와 목표가 조정을 함께 보세요.",
        );
      } else if (chg >= 2) {
        paras.push(
          "해석: 컨센 상향은 모멘텀 재료이나, 상향 폭 대비 주가 선반영 여부를 Analysis·차트로 확인하세요.",
        );
      } else {
        paras.push(
          "해석: 변동 폭이 작아 단독 재료로는 약합니다. 실적 시즌·섹터 흐름과 묶어 보는 편이 낫습니다.",
        );
      }
    } else {
      paras.push(
        `${sym} 컨센 스냅샷이 갱신됐지만 직전 대비 변동 %가 없습니다(첫 스냅이거나 동일 수준).`,
      );
    }
    if (hasYoy) {
      paras.push(
        `참고: 성장 감각 ${fmtPct(yoy)}` +
          (m.yoyLabel ? ` — ${m.yoyLabel}` : "") +
          ".",
      );
    }
    if (m.numAnalysts != null) {
      paras.push(`추정 참여 애널 수(참고): ${m.numAnalysts}명.`);
    }
  } else if (kind === "governance") {
    const t = String(title || "").trim();
    const f = String(form || "").toUpperCase();
    const blob = `${t} ${body}`;
    const isAddl =
      /DEFA14A/i.test(f) || /additional\s+(?:definitive\s+)?proxy/i.test(blob);
    paras.push(
      isAddl
        ? `${sym} 이번 건은 추가 Proxy 자료(DEFA14A)입니다. 정기 DEF 14A와 날짜·목적이 다른 별도 제출입니다.`
        : `${sym} 이번 건은 정기 Proxy 성명서(DEF 14A)입니다. 주주총회 본안건을 담습니다.`,
    );
    if (/compensation|executive|pay|보수|say.?on.?pay/i.test(blob)) {
      paras.push(
        "해석: 임원 보수·성과급·스톡옵션 규모가 희석·비용으로 이어질 수 있습니다. 이사회 권고·주주제안 찬반을 원문에서 확인하세요.",
      );
    } else if (/buyback|repurchase|dividend|자사주|배당/i.test(blob)) {
      paras.push(
        "해석: 배당·자사주 등 자본배분 안건입니다. 환원 규모와 기간이 주주가치에 미치는 영향을 원문에서 확인하세요.",
      );
    } else if (/director|board|nominee|이사|이사회/i.test(blob)) {
      paras.push(
        "해석: 이사회·이사 선임이 핵심입니다. 독립성·관련 당사자 거래·안건 찬반을 원문에서 확인하세요.",
      );
    } else {
      paras.push(
        t
          ? `제목 기준: ${t.slice(0, 100)}. 배당·자사주·희석·이사회·주주제안 중 해당 안건을 원문에서 특정하세요.`
          : "배당·자사주·희석·이사회·주주제안 중 어떤 안건인지 원문에서 특정하세요.",
      );
    }
    paras.push(
      "참고: 거버넌스 카드에는 실적 Beat/Miss·컨센 EPS를 넣지 않습니다(종목 공통 Yahoo 스냅과 혼동 방지).",
    );
  } else {
    // earnings
    if (hasVs) {
      const beat = vs > 1;
      const miss = vs < -1;
      paras.push(
        `${sym} 최근 확정 실적은 컨센 대비 ${fmtPct(vs)}로 ` +
          (beat ? "Beat(상회)" : miss ? "Miss(하회)" : "컨센 부근") +
          "입니다." +
          (m.vsConsensusLabel ? ` ${m.vsConsensusLabel}.` : ""),
      );
      if (beat) {
        paras.push(
          "해석: Beat는 단기 긍정 재료이나, 가이던스 톤이 보수면 주가 반응이 약할 수 있습니다.",
        );
      } else if (miss) {
        paras.push(
          "해석: Miss는 단기 압력 재료입니다. 일회성 비용 여부와 다음 분기 가이던스를 원문에서 확인하세요.",
        );
      } else {
        paras.push(
          "해석: 컨센에 근접한 실적이라 숫자 서프라이즈는 제한적입니다. MD&A·세그먼트 톤이 방향을 좌우합니다.",
        );
      }
    } else {
      paras.push(
        `${sym} ${form || "실적"} 공시이지만 Yahoo Beat/Miss %가 아직 없습니다.`,
      );
    }
    if (hasYoy) {
      paras.push(
        `전년 관련 ${fmtPct(yoy)}` +
          (m.yoyLabel ? ` — ${m.yoyLabel}` : "") +
          (yoy >= 5
            ? ". 성장이 확인되면 배수 유지에 우호적입니다."
            : yoy <= -5
              ? ". 역성장이면 마진·수요 둔화 여부를 원문에서 확인하세요."
              : ". 성장률 변화 폭은 크지 않습니다."),
      );
    }
    if (hasChg) {
      paras.push(
        `애널 컨센 직전 대비 ${fmtPct(chg)}` +
          (chg <= -2
            ? " — 이미 눈높이가 낮아진 상태일 수 있습니다."
            : chg >= 2
              ? " — 눈높이 상향이 동반되고 있습니다."
              : " — 컨센은 거의 그대로입니다."),
      );
    }
    if (filingLines.length) {
      paras.push(`공시에서 추출된 수치: ${filingLines.slice(0, 3).join("; ")}.`);
    }
  }

  if (hasFilingText) {
    paras.push(`근거: EDGAR${form ? ` (${form})` : ""} 본문 + Yahoo 메트릭`);
  } else if (hasVs || hasYoy || hasChg) {
    paras.push("근거: Yahoo 메트릭(공시 HTML 미수집 — 링크 원문으로 교차 확인)");
  } else {
    paras.push("근거: 양식·제목 메타(수치·본문 부족 — EDGAR/Yahoo 링크 확인)");
  }

  return paras.join("\n\n").slice(0, 1400);
}

/**
 * @param {string} form
 * @param {string} kind
 * @param {string} title
 * @param {string} text
 * @param {Record<string, unknown> | null | undefined} [metrics]
 * @param {string} [symbol]
 */
export function buildFilingHeadlineAndDetail(
  form,
  kind,
  title,
  text,
  metrics,
  symbol = "",
) {
  const about = buildAboutFromFiling(form, kind, title, text);
  const filingLines = extractFilingNumberLines(text);
  const numbersBrief = buildNumbersBrief(metrics, filingLines, kind);
  const interpretation = buildInterpretationFromBrief({
    kind,
    symbol,
    form,
    title,
    about,
    numbersBrief,
    metrics,
    filingLines,
    hasFilingText: Boolean(String(text ?? "").trim()),
    filingText: text,
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
    headline = /DEFA14A/i.test(f)
      ? "추가 Proxy(DEFA14A)"
      : /DEF\s*14A/i.test(f) || /DEFINITIVE PROXY/i.test(String(title ?? ""))
        ? "정기 Proxy(DEF 14A)"
        : "거버넌스·Proxy 공시";
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
  const formU = String(form ?? "").toUpperCase();
  const wantsDeep =
    kind === "earnings" ||
    /^10-[QK]/.test(formU) ||
    (kind === "guidance" && /8-K/i.test(formU));
  let text = "";
  let filingFetchOk = false;

  if (cardLike.edgarUrl) {
    const fetched = await fetchEdgarFilingPlainText(cardLike.edgarUrl, {
      maxChars: wantsDeep ? 80_000 : 48_000,
    });
    if (fetched.ok) {
      text = fetched.text;
      filingFetchOk = true;
    }
  }

  let { headline, about, numbersBrief, interpretation, detail } =
    buildFilingHeadlineAndDetail(
      form ?? "",
      kind,
      title,
      text,
      cardLike.metrics,
      symbol,
    );

  interpretation = buildInterpretationFromBrief({
    kind,
    symbol: symbol || "—",
    form,
    title,
    about,
    numbersBrief,
    metrics: cardLike.metrics,
    filingLines: extractFilingNumberLines(text),
    hasFilingText: filingFetchOk,
    filingText: text,
  });

  let article = buildArticleFromFiling({
    kind,
    symbol: symbol || "—",
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    filingText: text,
    hasFilingText: filingFetchOk,
    metrics: cardLike.metrics,
  });
  detail = article.slice(0, 1400);

  let deepAnalysis = buildDeepAnalysisFromFiling({
    kind,
    symbol: symbol || "—",
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    article,
    filingText: text,
    hasFilingText: filingFetchOk,
    metrics: cardLike.metrics,
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
      const systemDeep =
        'Reply in Korean JSON only: {"headline":"<=40 chars","about":"2 short Korean sentences summarizing WHAT this filing says","numbers":"bullets with \\n from metrics/text only","interpretation":"2-4 short Korean judgments with numbers","article":"5-8 Korean paragraphs separated by \\n\\n","deepAnalysis":"Long structured Korean analysis using markdown ## headings exactly in this order: ## 한줄 요약, ## 핵심 실적·수치, ## 사업·세그먼트 포인트, ## 특이 항목 (기타이익·투자·CapEx·M&A), ## 재무상태·현금흐름, ## 리스크·소송·규제, ## 해석·투자 관점, ## 근거. Depth similar to a detailed 10-Q investor brief: tables of key figures when present, segment growth, one-offs vs operating income, capex/FCF, M&A, legal. Separate paragraphs with \\n\\n. Do NOT invent facts not in the text/metrics. Do NOT use generic how-to filler."}';
      const systemShort =
        'Reply in Korean JSON only: {"headline":"<=40 chars","about":"2 short Korean sentences summarizing WHAT this filing says","numbers":"bullets with \\n from metrics/text only","interpretation":"2-4 short Korean judgments with numbers","article":"5-8 Korean paragraphs separated by \\n\\n. Write as a readable article based on the EDGAR text: what was disclosed, key figures/agenda, and what it means. Do NOT invent facts not in the text/metrics. Do NOT use generic how-to filler.","deepAnalysis":"Same article expanded with ## section headings (한줄 요약 / 핵심 실적·수치 / 사업·세그먼트 포인트 / 특이 항목 / 재무상태·현금흐름 / 리스크·소송·규제 / 해석·투자 관점 / 근거) when useful; otherwise mirror article with those headings."}';
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
          temperature: 0.25,
          max_tokens: wantsDeep ? 3600 : 1800,
          messages: [
            {
              role: "system",
              content: wantsDeep ? systemDeep : systemShort,
            },
            {
              role: "user",
              content: `Symbol ${symbol} form ${form} kind ${kind} title ${title}
Yahoo/metrics JSON: ${JSON.stringify(cardLike.metrics || {})}
Draft about: ${about}
Draft numbers: ${numbersBrief}
Draft interpretation: ${interpretation}
Draft article (improve into natural Korean prose grounded in filing): ${article.slice(0, 2500)}
Draft deepAnalysis outline (improve; keep ## headings): ${deepAnalysis.slice(0, wantsDeep ? 4500 : 2000)}
EDGAR plain text (primary source — stay faithful):
${text.slice(0, wantsDeep ? 28000 : 14000)}
Yahoo link: ${cardLike.yahooUrl || ""}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(wantsDeep ? 90_000 : 55_000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = String(data?.choices?.[0]?.message?.content ?? "").trim();
        const matched = raw.match(/\{[\s\S]*\}/);
        if (matched) {
          const parsed = JSON.parse(matched[0]);
          if (parsed.headline) headline = String(parsed.headline).slice(0, 120);
          if (parsed.about) about = String(parsed.about).slice(0, 700);
          if (parsed.numbers) numbersBrief = String(parsed.numbers).slice(0, 900);
          if (parsed.interpretation) {
            interpretation = String(parsed.interpretation).slice(0, 1600);
          }
          if (parsed.article) article = String(parsed.article).slice(0, 6000);
          if (parsed.deepAnalysis) {
            deepAnalysis = String(parsed.deepAnalysis).slice(
              0,
              DEEP_ANALYSIS_MAX_CHARS,
            );
          }
          detail = article.slice(0, 1400);
          engine = filingFetchOk ? "edgar+openai" : "metrics+openai";
        }
      }
    } catch {
      /* keep rules */
    }
  }

  if ((!about || about.length < 40) && article) {
    about = article.split(/\n\n/)[0]?.slice(0, 400) || about;
  }

  if (!deepAnalysis || deepAnalysis.length < 200) {
    deepAnalysis = buildDeepAnalysisFromFiling({
      kind,
      symbol: symbol || "—",
      form,
      title,
      about,
      numbersBrief,
      interpretation,
      article,
      filingText: text,
      hasFilingText: filingFetchOk,
      metrics: cardLike.metrics,
    });
  }

  return {
    headline,
    about,
    numbersBrief,
    interpretation,
    article,
    deepAnalysis,
    detail,
    analysisVersion: ANNOUNCEMENT_ANALYSIS_VERSION,
    analysisEngine: engine,
    filingTextChars: text.length,
    enrichedAt: Date.now(),
  };
}
