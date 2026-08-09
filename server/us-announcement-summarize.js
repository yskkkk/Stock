/**
 * EDGAR/링크 본문 → 발표 요지·수치·AI 해석 (규칙 + optional OpenAI)
 */
import { fetchEdgarFilingPlainText } from "./us-announcement-filing-text.js";

/** 카드 링크 분석 스키마 버전 */
export const ANNOUNCEMENT_ANALYSIS_VERSION = 5;

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
    const blob = `${t} ${body}`;
    if (/compensation|executive|pay|보수/i.test(blob)) {
      paras.push(
        `${sym} 이번 공시는 임원 보상·보수 체계가 핵심인 거버넌스 안건입니다.`,
      );
      paras.push(
        "해석: 성과급·스톡옵션 규모가 희석·비용으로 이어질 수 있어, 주주제안·이사회 권고 방향을 원문에서 확인하세요.",
      );
    } else if (/buyback|repurchase|dividend|자사주|배당/i.test(blob)) {
      paras.push(
        `${sym} 배당·자사주 등 자본배분 관련 거버넌스/공시로 읽힙니다.`,
      );
      paras.push(
        "해석: 환원 확대는 주주 우호, 과도한 희석·부채 증가는 부담 요인이므로 규모와 기간을 원문에서 확인하세요.",
      );
    } else if (/director|board|nominee|이사|이사회/i.test(blob)) {
      paras.push(`${sym} 이사회·이사 선임 관련 Proxy/거버넌스 공시입니다.`);
      paras.push(
        "해석: 이사회 독립성·관련 당사자 거래·안건 찬반이 지배구조 리스크 판단의 포인트입니다.",
      );
    } else {
      paras.push(
        `${sym} 거버넌스 공시(${form || t || "Proxy/8-K"})입니다.` +
          (t ? ` 제목: ${t.slice(0, 80)}.` : ""),
      );
      paras.push(
        filingLines.length
          ? `원문에서 확인된 수치/문구: ${filingLines.slice(0, 2).join("; ")}. 배당·자사주·희석·이사회 안건 중 어디에 해당하는지로 해석을 좁히세요.`
          : "해석: 배당·자사주·희석·이사회·주주제안 중 어떤 안건인지 원문에서 특정한 뒤 자본배분 영향을 판단하세요.",
      );
    }
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
  const numbersBrief = buildNumbersBrief(metrics, filingLines);
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
  detail = `${about}\n${numbersBrief}`.slice(0, 1400);

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
                'Reply in Korean JSON only: {"headline":"<=40 chars","about":"1-2 sentences what THIS filing is","numbers":"one bullet per line (\\n), figures only","interpretation":"2-4 short paragraphs (\\n\\n). MUST state a direct judgment for THIS symbol using the given % and labels (e.g. Beat/Miss, conservative/optimistic guidance, consensus up/down). Do NOT give generic how-to advice. Do NOT invent numbers."}',
            },
            {
              role: "user",
              content: `Symbol ${symbol} form ${form} kind ${kind} title ${title}
Yahoo/metrics JSON: ${JSON.stringify(cardLike.metrics || {})}
Draft about: ${about}
Draft numbers: ${numbersBrief}
Draft interpretation (keep concrete judgment): ${interpretation}
EDGAR text:
${text.slice(0, 9000)}
Yahoo link: ${cardLike.yahooUrl || ""}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(35_000),
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
          detail = `${about}\n${numbersBrief}`.slice(0, 1400);
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
