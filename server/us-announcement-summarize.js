/**
 * EDGAR/링크 본문 → 발표 요지·수치·AI 해석 (규칙 + optional OpenAI)
 */
import { fetchEdgarFilingPlainText } from "./us-announcement-filing-text.js";

/** 카드 링크 분석 스키마 버전 (11 = 원문 없을 때도 메트릭·종류별 구체 분석) */
export const ANNOUNCEMENT_ANALYSIS_VERSION = 11;

/** 상세 분석 최대 글자 (긴 10-Q 요약용) */
export const DEEP_ANALYSIS_MAX_CHARS = 22_000;

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
 * 공시 평문에서 자주 쓰는 수치 패턴 추출 (구체 숫자 위주)
 * @param {string} text
 * @returns {string[]}
 */
export function extractFilingNumberLines(text) {
  const body = String(text ?? "").replace(/\s+/g, " ");
  if (!body) return [];
  /** @type {string[]} */
  const hits = [];
  /**
   * @param {string} line
   */
  const push = (line) => {
    const t = String(line).replace(/\s+/g, " ").trim().slice(0, 160);
    if (!t || hits.includes(t)) return;
    hits.push(t);
  };
  const patterns = [
    {
      re: /(?:diluted\s+)?(?:net\s+)?(?:income|earnings)\s+(?:per\s+(?:common\s+)?share|EPS)[^.]{0,40}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "희석/주당이익(EPS)",
    },
    {
      re: /(?:basic|diluted)\s+(?:net\s+income\s+per\s+common\s+share|EPS)[^.]{0,30}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "EPS",
    },
    {
      re: /(?:total\s+)?revenues?(?:\s+was|\s+were|\s+of|:)?[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
      label: "연결 매출",
    },
    {
      re: /operating\s+(?:income|profit|margin)[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn|%)?/gi,
      label: "영업이익",
    },
    {
      re: /net\s+income(?:\s+available\s+to\s+common\s+stockholders)?[^.]{0,40}?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
      label: "순이익",
    },
    {
      re: /Google Search\s*(?:&|and)?\s*other[^$0-9]{0,30}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)/gi,
      label: "검색 등 매출",
    },
    {
      re: /YouTube ads[^$0-9]{0,30}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)/gi,
      label: "YouTube 광고 매출",
    },
    {
      re: /Google (?:advertising|Network)[^$0-9]{0,30}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)/gi,
      label: "광고 합계/네트워크",
    },
    {
      re: /Google Cloud[^.]{0,80}?(?:increased|grew|was|were|of|:)?[^$0-9%]{0,20}(\d+(?:\.\d+)?)\s*%[^$]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "Google Cloud",
      format: (m) =>
        `Google Cloud ${m[2] ? `$${m[2]}${m[3] ? ` ${m[3]}` : ""}` : ""}${m[1] ? ` · 성장 ${m[1]}%` : ""}`.trim(),
    },
    {
      re: /Google Cloud[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "Google Cloud 매출",
    },
    {
      re: /(?:subscriptions?|platforms?|devices?)[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)/gi,
      label: "구독·플랫폼·기기",
    },
    {
      re: /other income(?:\s*\(expense\))?(?:,?\s*net)?[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "기타이익(순)",
    },
    {
      re: /(?:unrealized|gain|loss).{0,40}equity securit[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "지분 평가손익",
    },
    {
      re: /purchases of property and equipment[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "설비투자(CapEx)",
    },
    {
      re: /(?:capital expenditures?|capex)[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "설비투자(CapEx)",
    },
    {
      re: /(?:free cash flow|net cash provided by operating activities)[^$0-9-]{0,40}\(?\$?-?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\)?\s*(billion|million)?/gi,
      label: "영업CF/FCF",
    },
    {
      re: /(?:cash and cash equivalents|total cash[^,]{0,40}marketable securities)[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "현금·유가증권",
    },
    {
      re: /(?:long-term debt|total long-term debt)[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "장기부채",
    },
    {
      re: /(?:revenue backlog|remaining performance obligations?)[^$0-9]{0,40}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "매출 백로그",
    },
    {
      re: /(?:acquisition|acquired)\s+(?:of\s+)?([A-Za-z][A-Za-z0-9 .-]{1,40}?)(?:\s+for|\s+at)?[^$0-9]{0,30}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million)?/gi,
      label: "인수",
      format: (m) =>
        `인수 ${String(m[1]).trim()} $${m[2]}${m[3] ? ` ${m[3]}` : ""}`,
    },
    {
      re: /(?:full[- ]year|FY\s*\d{2,4}|fiscal\s+year)[^.]{0,80}?(?:EPS|earnings per share|revenue)[^.]{0,60}?\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "연간 가이던스 수치",
    },
    {
      re: /(?:expects?|guides?|outlook)[^.]{0,100}?\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:to|-|–)\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/gi,
      label: "가이던스 레인지",
    },
    {
      re: /(?:employees|number of employees)[^0-9]{0,30}([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      label: "직원 수",
    },
  ];

  for (const row of patterns) {
    const re = row.re;
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(body)) && guard < 4) {
      guard += 1;
      if (typeof row.format === "function") {
        push(row.format(m));
        continue;
      }
      const unit = m[2] ? ` ${m[2]}` : "";
      const range = m[3] ? `–${m[3]}` : "";
      const val = `${m[1]}${range}${unit}`.trim();
      push(`${row.label} ${val}`);
    }
  }
  return hits.slice(0, 18);
}

/**
 * 주제별 구체 사실(숫자 포함 한글)을 공시에서 대량 수집
 * @param {string} text
 * @returns {{
 *   segments: string[];
 *   special: string[];
 *   balance: string[];
 *   risks: string[];
 *   extras: string[];
 * }}
 */
export function extractConcreteFilingFacts(text) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  /** @type {{ segments: string[]; special: string[]; balance: string[]; risks: string[]; extras: string[] }} */
  const out = {
    segments: [],
    special: [],
    balance: [],
    risks: [],
    extras: [],
  };
  if (!body) return out;

  /**
   * @param {string[]} bucket
   * @param {string | null} line
   * @param {number} max
   */
  const add = (bucket, line, max) => {
    const t = String(line ?? "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 8) return;
    if (bucket.some((x) => x.slice(0, 36) === t.slice(0, 36))) return;
    if (bucket.length >= max) return;
    bucket.push(t.slice(0, 220));
  };

  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35 && s.length <= 480)
    .filter((s) => !isFilingNoise(s));

  const segRe =
    /Google (?:Search|Cloud|Network|Services)|YouTube|subscription|segment|advertising revenues?|operating income|Workspace|TPU/i;
  const specialRe =
    /other income|unrealized|equity securit|SpaceX|Anthropic|capital expenditure|purchases of property|acquisition|acquired|goodwill|Wiz|Intersect|repurchase|dividend|mandatory convertible|issued .+ notes|free cash flow/i;
  const balRe =
    /cash and cash equivalents|marketable securities|total assets|long-term debt|operating activities|investing activities|financing activities|backlog|remaining performance|inventory|property and equipment/i;
  const riskRe =
    /antitrust|Department of Justice|European Commission|litigation|Legal Proceedings|Risk Factors|fine|remed(?:y|ies)|General Court|appealed/i;

  for (const s of sentences) {
    const ko = koSummarizeFilingSentence(s);
    if (!ko) continue;
    // 숫자·고유명사 없는 너무 얇은 줄은 스킵
    const hasMeat =
      /\$|%|\d/.test(ko) ||
      /인수|벌금|반독점|Cloud|YouTube|검색|CapEx|백로그|평가/.test(ko);
    if (!hasMeat) continue;
    if (segRe.test(s)) add(out.segments, ko, 10);
    else if (specialRe.test(s)) add(out.special, ko, 10);
    else if (balRe.test(s)) add(out.balance, ko, 8);
    else if (riskRe.test(s)) add(out.risks, ko, 8);
    else if (/\$\s*\d/.test(s) && /revenue|income|EPS|billion|million/i.test(s)) {
      add(out.extras, ko, 8);
    }
  }

  // 표 형태 세그먼트 숫자 보강
  const tableLike = [
    [
      /Google Search\s*(?:&|and)?\s*other[^$0-9]{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      (m) => `검색 등(Search & other) 매출 $${m[1]}`,
    ],
    [
      /YouTube ads[^$0-9]{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      (m) => `YouTube 광고 매출 $${m[1]}`,
    ],
    [
      /Google Network[^$0-9]{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      (m) => `네트워크 광고 매출 $${m[1]}`,
    ],
    [
      /Google advertising[^$0-9]{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      (m) => `광고 합계 $${m[1]}`,
    ],
    [
      /Google Cloud[^$0-9]{0,20}\$?\s*([0-9]{1,3}(?:,[0-9]{3})+)/gi,
      (m) => `Google Cloud 매출 $${m[1]}`,
    ],
    [
      /Google Cloud[^.]{0,60}increased\s+(\d+(?:\.\d+)?)\s*%[^$]{0,30}\$?\s*([0-9,.]+)\s*(billion|million)?/gi,
      (m) =>
        `Google Cloud $${m[2]}${m[3] ? ` ${m[3]}` : ""} · 전년 대비 +${m[1]}%`,
    ],
  ];
  for (const [re, fmt] of tableLike) {
    re.lastIndex = 0;
    let m;
    let g = 0;
    while ((m = re.exec(body)) && g < 3) {
      g += 1;
      add(out.segments, fmt(m), 12);
    }
  }

  return out;
}

/**
 * TOC·체크박스·표지 문구 등 분석에 쓸 수 없는 문장
 * @param {string} s
 */
export function isFilingNoise(s) {
  const t = String(s ?? "");
  if (!t.trim()) return true;
  if (/☐|☒|\[\s*\]|indicate by check mark|shell company/i.test(t)) return true;
  if (/table of contents|page no\.|form 10-[qk]\b/i.test(t)) return true;
  if (/forward-looking statements|private securities litigation reform/i.test(t)) {
    return true;
  }
  if (/securities (?:and )?exchange (?:act|commission)/i.test(t)) return true;
  if (/\bsignatures?\b.{0,20}\b\d{1,3}\b/i.test(t)) return true;
  if (/(?:item\s+\d+[a-z]?\b[^.]{0,80}){2,}/i.test(t)) return true;
  if (/\b\d{1,3}\s+(?:item\s+\d)/i.test(t) && /item\s+\d/i.test(t)) {
    const itemHits = t.match(/\bitem\s+\d+[a-z]?\b/gi) || [];
    if (itemHits.length >= 3) return true;
  }
  return false;
}

/**
 * 영문 공시 문장 → 한글 한 줄 해석 (원문 덤프 금지)
 * @param {string} s
 * @returns {string | null}
 */
export function koSummarizeFilingSentence(s) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t || isFilingNoise(t)) return null;

  const moneys = [
    ...t.matchAll(
      /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|\d+(?:\.\d+)?)\s*(billion|million|bn|mn)?/gi,
    ),
  ];
  const moneyStr = (i = 0) => {
    const money = moneys[i];
    if (!money) return null;
    return `$${money[1]}${money[2] ? ` ${money[2]}` : ""}`;
  };
  const pcts = [...t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
  const pctStr = (i = 0) => (pcts[i] ? `${pcts[i][1]}%` : null);

  const dirTo = t.match(
    /(increased|decreased|grew|fell|rose|declined|accelerated)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%[^.]{0,50}?(?:to|at)\s+\$?\s*([0-9,.]+)\s*(billion|million|bn|mn)?/i,
  );
  const dirOnly = t.match(
    /(increased|decreased|grew|fell|rose|declined)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i,
  );
  /**
   * @param {string} base
   */
  const withGrowth = (base) => {
    if (dirTo) {
      const up = /increas|grew|rose|acceler/i.test(dirTo[1]);
      return `${base} ${up ? "+" : "-"}${dirTo[2]}% → $${dirTo[3]}${dirTo[4] ? ` ${dirTo[4]}` : ""}`;
    }
    if (dirOnly) {
      const up = /increas|grew|rose|acceler/i.test(dirOnly[1]);
      return `${base}${moneyStr() ? ` ${moneyStr()}` : ""} (${up ? "+" : "-"}${dirOnly[2]}%)`;
    }
    const bits = [base];
    if (moneyStr()) bits.push(moneyStr());
    if (pctStr()) bits.push(pctStr());
    return bits.filter(Boolean).join(" · ");
  };

  if (/google cloud/i.test(t)) return withGrowth("Google Cloud");
  if (/youtube/i.test(t) && /(?:ads?|advertis|revenue)/i.test(t)) {
    return withGrowth("YouTube 광고");
  }
  if (/Google Search/i.test(t) || (/\bsearch\b/i.test(t) && /(?:revenue|ads?)/i.test(t))) {
    return withGrowth("검색·광고(Search)");
  }
  if (/Google (?:advertising|Services)|advertising revenues?/i.test(t)) {
    return withGrowth("광고/서비스 매출");
  }
  if (/subscription|platforms?|devices?/i.test(t) && /revenue/i.test(t)) {
    return withGrowth("구독·플랫폼·기기");
  }
  if (/total revenues?|consolidated revenues?|revenues? were|revenues? increased/i.test(t)) {
    return withGrowth("연결 매출");
  }
  if (/operating income|income from operations|operating margin/i.test(t)) {
    return withGrowth("영업이익");
  }
  if (/net income/i.test(t) && !/comprehensive/i.test(t)) {
    return withGrowth("순이익");
  }
  if (/(?:diluted|basic).{0,40}(?:EPS|per common share)|earnings per share/i.test(t)) {
    return withGrowth("EPS(희석/기본)");
  }
  if (/other income|unrealized|equity securit|SpaceX|Anthropic/i.test(t)) {
    const who = /SpaceX/i.test(t)
      ? "SpaceX 지분"
      : /Anthropic/i.test(t)
        ? "Anthropic 지분"
        : "지분·기타이익";
    return withGrowth(`${who} 평가/기타이익`);
  }
  if (/purchases of property|capital expenditure|capex/i.test(t)) {
    return withGrowth("설비투자(CapEx·유형자산 구매)");
  }
  if (/free cash flow/i.test(t)) return withGrowth("잉여현금흐름(FCF)");
  if (/acquisition|acquired|goodwill|Wiz|Intersect/i.test(t)) {
    const name = t.match(
      /(?:acquisition of|acquired)\s+([A-Z][A-Za-z0-9 .-]{1,30})/i,
    );
    return withGrowth(name ? `인수 ${name[1].trim()}` : "인수·영업권");
  }
  if (/repurchase|buyback/i.test(t)) return withGrowth("자사주 매입");
  if (/dividend/i.test(t)) return withGrowth("배당");
  if (/long-term debt|senior (?:unsecured )?notes|issued .+ notes|proceeds from issuance of debt/i.test(t)) {
    return withGrowth("부채·채권 발행/잔액");
  }
  if (/cash and cash equivalents|marketable securities/i.test(t)) {
    return withGrowth("현금·유가증권");
  }
  if (/total assets/i.test(t)) return withGrowth("총자산");
  if (/backlog|remaining performance obligation/i.test(t)) {
    return withGrowth("매출 백로그(미이행 계약)");
  }
  if (/operating activities/i.test(t) && /cash/i.test(t)) {
    return withGrowth("영업현금흐름");
  }
  if (/investing activities/i.test(t)) return withGrowth("투자현금흐름");
  if (/financing activities/i.test(t)) return withGrowth("재무현금흐름");
  if (/inventory/i.test(t) && moneyStr()) return withGrowth("재고");
  if (/property and equipment/i.test(t) && moneyStr()) {
    return withGrowth("유형자산");
  }
  if (/antitrust|department of justice|\bDOJ\b/i.test(t)) {
    const detail = moneyStr() ? ` (관련 금액 ${moneyStr()})` : "";
    return `미국 반독점(DOJ 등) 소송·구제명령 관련${detail}`;
  }
  if (/european commission|€|euro.+fine|General Court|EC decision/i.test(t)) {
    const detail = moneyStr() ? ` (관련 금액 ${moneyStr()})` : "";
    return `유럽 경쟁당국(EC) 벌금·규제·항소 관련${detail}`;
  }
  if (/legal proceedings|litigation|remed(?:y|ies)/i.test(t)) {
    return `소송·법적 절차·구제(remedy) 업데이트${moneyStr() ? ` · ${moneyStr()}` : ""}`;
  }
  if (/risk factor/i.test(t)) return "위험요인(Risk Factors) 업데이트";
  if (/guidance|outlook|expects?/i.test(t)) {
    return withGrowth("가이던스·아웃룩");
  }
  if (/employees|headcount/i.test(t) && /\d{3,}/.test(t)) {
    const n = t.match(/([0-9]{1,3}(?:,[0-9]{3})+)/);
    return n ? `직원 수 ${n[1]}명` : null;
  }

  const hangul = (t.match(/[가-힣]/g) || []).length;
  if (hangul >= 12 && /\$|%|\d/.test(t)) return t.slice(0, 220);

  // 숫자 있는 미분류 문장: 짧은 한글 라벨 + 금액
  if (moneyStr() && /revenue|income|EPS|billion|million|cash|debt/i.test(t)) {
    return `공시 수치 ${moneyStr()}${pctStr() ? ` (${pctStr()})` : ""}`;
  }

  return null;
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
        !isFilingNoise(s) &&
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
    const snip = body.slice(0, 220).trim();
    if (!isFilingNoise(snip)) {
      out.push(snip + (body.length > 220 ? "…" : ""));
    }
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
    /** @type {string[]} */
    const koLines = [];
    for (const ex of excerpts) {
      const ko = koSummarizeFilingSentence(ex);
      if (ko && !koLines.includes(ko)) koLines.push(ko);
    }
    if (koLines.length) {
      paras.push("EDGAR 원문에서 확인한 핵심을 한글로 정리하면 다음과 같습니다.");
      for (let i = 0; i < koLines.length; i += 1) {
        paras.push(`(${i + 1}) ${koLines[i]}`);
      }
    } else {
      paras.push(
        "EDGAR 본문에서 수치·사업 요지를 추출했으며, 아래 해석과 함께 원문 링크를 대조하세요.",
      );
    }
  } else if (!hasFilingText) {
    paras.push(
      "EDGAR HTML 본문을 이번 수집에서 못 읽었습니다. 아래는 Yahoo 지표·카드 요지로 채운 요약이며, EDGAR 링크로 숫자를 재확인하세요.",
    );
  }

  const fill = buildMetricDrivenSectionFills({
    kind,
    symbol: sym,
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    metrics: args.metrics,
  });
  if (fill.numbers.length) {
    paras.push(
      "카드·Yahoo 수치:\n" +
        fill.numbers
          .slice(0, 10)
          .map((s, i) => `${i + 1}. ${s}`)
          .join("\n"),
    );
  } else if (numbersBrief && !String(numbersBrief).includes("표시하지 않습니다")) {
    paras.push(`관련 수치 요약: ${String(numbersBrief).replace(/\n/g, "; ")}`);
  } else if (kind === "governance") {
    paras.push(
      "이 공시는 실적 Beat/Miss와 직접 대응되지 않는 거버넌스·Proxy 성격입니다. 보수·이사회·주주제안 등 안건 자체를 중심으로 읽어야 합니다.",
    );
  }
  if (!hasFilingText && fill.segments.length) {
    paras.push(fill.segments.slice(0, 4).join(" "));
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
      : "근거 자료: Yahoo 메트릭·카드 메타(EDGAR HTML 미수집). EDGAR/Yahoo 원문과 교차 확인하세요.",
  );

  return paras.join("\n\n").slice(0, 6000);
}

/**
 * 공시 평문에서 주제별 힌트를 한글 한 줄로 수집
 * @param {string} text
 * @param {RegExp} re
 * @param {number} [limit]
 * @returns {string[]}
 */
function pickTopicSentencesKo(text, re, limit = 3) {
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return [];
  /** @type {string[]} */
  const out = [];
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 420)
    .filter((s) => !isFilingNoise(s));
  for (const s of sentences) {
    if (!re.test(s)) continue;
    const ko = koSummarizeFilingSentence(s);
    if (!ko) continue;
    if (out.some((x) => x.slice(0, 28) === ko.slice(0, 28))) continue;
    out.push(ko);
    if (out.length >= limit) break;
  }
  return out;
}

const DEEP_TOC_ITEMS = [
  "한줄 요약",
  "핵심 실적·수치",
  "사업·세그먼트 포인트",
  "특이 항목 (기타이익·투자·CapEx·M&A)",
  "재무상태·현금흐름",
  "리스크·소송·규제",
  "해석·투자 관점",
  "근거",
];

/**
 * 상세 분석 본문에서 영문 덤프·노이즈 줄 제거, 목차 보장
 * @param {string} text
 */
export function sanitizeDeepAnalysisKo(text) {
  let body = String(text ?? "").trim();
  if (!body) return body;
  const blocks = body.split(/\n(?=##\s)/);
  /** @type {string[]} */
  const cleaned = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const head = lines[0] ?? "";
    /** @type {string[]} */
    const keep = [head];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      const trim = line.trim();
      if (!trim) {
        keep.push(line);
        continue;
      }
      if (isFilingNoise(trim)) continue;
      const letters = trim.replace(/[^a-zA-Z가-힣]/g, "");
      if (letters.length >= 24) {
        const latin = (letters.match(/[a-zA-Z]/g) || []).length;
        if (latin / letters.length > 0.55) {
          const ko = koSummarizeFilingSentence(trim.replace(/^\(\d+\)\s*/, ""));
          if (ko) keep.push(ko);
          continue;
        }
      }
      keep.push(line);
    }
    if (keep.length > 1 || /^##\s/.test(head)) cleaned.push(keep.join("\n"));
  }
  body = cleaned.join("\n\n").trim();
  if (!/^##\s*목차/m.test(body)) {
    const toc =
      "## 목차\n" +
      DEEP_TOC_ITEMS.map((t, i) => `${i + 1}. ${t}`).join("\n");
    body = `${toc}\n\n${body}`;
  }
  return body.slice(0, DEEP_ANALYSIS_MAX_CHARS);
}

/**
 * LLM이 만든 상세 분석이 '못 찾음' 위주면 규칙 버전으로 교체
 * @param {string} text
 */
export function isThinDeepAnalysis(text) {
  const body = String(text ?? "");
  if (body.length < 280) return true;
  const emptyRe =
    /충분히 특정하지 못|못 찾았|추출되지 않았|구성하지 못|링크 본문 미수집|표시할 EPS·컨센·가이던스 수치가 카드에도 없/g;
  const hits = body.match(emptyRe) || [];
  if (hits.length >= 2) return true;
  const hasConcrete =
    /\d+\.\d+%|컨센 대비|가이던스 EPS|확정 EPS|전방 컨센|YoY|\+\d|-\d|\$\d/.test(
      body,
    );
  if (!hasConcrete && hits.length >= 1) return true;
  return false;
}

/**
 * 공시 본문 없이도 카드 메트릭·종류로 채울 구체 섹션
 * @param {{
 *   kind: string;
 *   symbol: string;
 *   form?: string | null;
 *   title?: string;
 *   about?: string;
 *   numbersBrief?: string;
 *   interpretation?: string;
 *   metrics?: Record<string, unknown> | null;
 * }} args
 */
export function buildMetricDrivenSectionFills(args) {
  const kind = String(args.kind ?? "");
  const sym = String(args.symbol || "").trim() || "해당 종목";
  const f = String(args.form ?? "").toUpperCase();
  const title = String(args.title ?? "").trim();
  const about = String(args.about ?? "").trim();
  const m =
    args.metrics && typeof args.metrics === "object" ? args.metrics : null;
  /** @type {{ numbers: string[]; segments: string[]; special: string[]; balance: string[]; risks: string[]; takeaways: string[] }} */
  const out = {
    numbers: [],
    segments: [],
    special: [],
    balance: [],
    risks: [],
    takeaways: [],
  };

  const vs = m ? fmtPct(/** @type {number|null} */ (m.vsConsensusPct)) : null;
  const yoy = m ? fmtPct(/** @type {number|null} */ (m.yoyPct)) : null;
  const chg = m ? fmtPct(/** @type {number|null} */ (m.consensusChangePct)) : null;
  const rep = m ? fmtNum(/** @type {number|null} */ (m.reportedEps)) : null;
  const fwd = m ? fmtNum(/** @type {number|null} */ (m.consensusEps)) : null;
  const q = m ? fmtNum(/** @type {number|null} */ (m.quarterConsensusEps)) : null;
  const trail = m ? fmtNum(/** @type {number|null} */ (m.trailingEps)) : null;
  const guide = m ? fmtNum(/** @type {number|null} */ (m.guidanceEps)) : null;
  const prior = m ? fmtNum(/** @type {number|null} */ (m.priorConsensusEps)) : null;
  const yearAgo = m ? fmtNum(/** @type {number|null} */ (m.yearAgoEps)) : null;
  const period = m && m.period != null ? String(m.period) : null;
  const nAnal = m && m.numAnalysts != null ? Number(m.numAnalysts) : null;

  if (guide) out.numbers.push(`가이던스 EPS(카드) ${guide}`);
  if (rep) out.numbers.push(`Yahoo 최근 확정 EPS ${rep}`);
  if (q) out.numbers.push(`당분기 컨센 EPS ${q}`);
  if (fwd) out.numbers.push(`전방 컨센 EPS ${fwd}`);
  if (prior) out.numbers.push(`직전 컨센 EPS ${prior}`);
  if (trail) out.numbers.push(`트레일링 EPS ${trail}`);
  if (yearAgo) out.numbers.push(`전년 동기 EPS ${yearAgo}`);
  if (vs) {
    out.numbers.push(
      `컨센 대비 ${vs}${m?.vsConsensusLabel ? ` — ${m.vsConsensusLabel}` : ""}`,
    );
  }
  if (yoy) {
    out.numbers.push(
      `전년 대비 ${yoy}${m?.yoyLabel ? ` — ${m.yoyLabel}` : ""}`,
    );
  }
  if (chg) {
    out.numbers.push(
      `컨센 변동 ${chg}${m?.consensusChangeLabel ? ` — ${m.consensusChangeLabel}` : ""}`,
    );
  }
  if (period) out.numbers.push(`Yahoo 기준 기간 ${period}`);
  if (Number.isFinite(nAnal)) out.numbers.push(`추정 참여 애널(참고) ${nAnal}명`);

  const briefLines = String(args.numbersBrief ?? "")
    .split(/\n+|(?:\s·\s)/)
    .map((s) => s.replace(/^수치 요약\s*[—–-]\s*/, "").trim())
    .filter(Boolean);
  for (const line of briefLines) {
    if (!out.numbers.some((x) => x.includes(line.slice(0, 24)))) {
      out.numbers.push(line);
    }
  }

  if (kind === "guidance" || (/8-K/i.test(f) && kind !== "earnings")) {
    out.segments.push(
      `${sym} ${f || "8-K"}는 세그먼트 매출표(10-Q)가 아니라 가이던스·실적 업데이트 성격입니다.`,
    );
    if (guide && fwd) {
      out.segments.push(
        `경영진 가이던스 EPS ${guide} vs 시장 전방 컨센 ${fwd}` +
          (vs ? ` (괴리 ${vs})` : ""),
      );
    } else if (vs) {
      out.segments.push(
        `가이던스/실적 숫자가 시장 컨센 대비 ${vs}로 카드에 잡혀 있습니다` +
          (m?.vsConsensusLabel ? ` — ${m.vsConsensusLabel}` : ""),
      );
    }
    if (q && yearAgo) {
      out.segments.push(
        `성장 감각: 당분기 컨센 ${q} vs 전년 동기 ${yearAgo}` +
          (yoy ? ` (${yoy})` : ""),
      );
    }
    if (about) out.segments.push(`발표 요지: ${about}`);
    if (title && title !== f) out.segments.push(`공시 제목: ${title.slice(0, 120)}`);

    out.special.push(
      "8-K에서 흔히 같이 보는 항목: 연간/분기 가이던스 레인지, 매출·마진 전제(환율·수요), 일회성 비용, 자사주·배당 코멘트.",
    );
    if (vs && Number(m?.vsConsensusPct) > 2) {
      out.special.push(
        `컨센 대비 낙관(+): 시장 추정치보다 가이던스가 높아 컨센 상향 여지를 줄 수 있습니다. 이미 주가에 반영됐는지는 별도 확인이 필요합니다.`,
      );
    } else if (vs && Number(m?.vsConsensusPct) < -2) {
      out.special.push(
        `컨센 대비 보수(-): 가이던스 미스 인식이 나올 수 있습니다. 가이던스 하향 폭과 다음 분기 전제를 원문 Item에서 확인하세요.`,
      );
    }
    out.special.push(
      "원문 Item 2.02(실적)·7.01/8.01(기타) 중 어디에 숫자가 있는지 EDGAR에서 대조하세요.",
    );

    out.balance.push(
      "가이던스 8-K는 대차대조표 전면 개정이 아닌 경우가 많습니다. 현금·부채 표는 직전 10-Q/10-K와 함께 보세요.",
    );
    if (trail || fwd) {
      out.balance.push(
        `밸류에이션 감각용 Yahoo EPS: 트레일링 ${trail || "—"} / 전방 ${fwd || "—"} (배수 계산은 시가와 별도).`,
      );
    }
    out.balance.push(
      "현금흐름·CapEx 구체 금액은 이번 카드에 EDGAR 본문이 없으면 비어 있을 수 있습니다. 링크 원문·실적자료 PDF를 우선하세요.",
    );

    out.risks.push(
      "가이던스 미달·전제(수요/환율/공급망) 훼손 시 컨센·주가 동반 조정 위험.",
    );
    out.risks.push(
      "낙관 가이던스라도 마진·일회성·회계 전제가 보수/공격적인지 원문 각주를 확인해야 합니다.",
    );
    if (Number.isFinite(nAnal) && nAnal < 10) {
      out.risks.push(`애널 커버리지가 ${nAnal}명으로 적어 컨센 신뢰도가 낮을 수 있습니다.`);
    }
  } else if (kind === "consensus") {
    out.segments.push(
      `${sym} 컨센서스 변경 이벤트입니다. 공시 세그먼트표가 아니라 Yahoo Analysis 추정치 스냅샷 기준입니다.`,
    );
    if (chg) {
      out.segments.push(
        `직전 스냅 대비 컨센 ${chg}` +
          (m?.consensusChangeLabel ? ` — ${m.consensusChangeLabel}` : ""),
      );
    }
    if (fwd && prior) out.segments.push(`전방 EPS ${prior} → ${fwd}`);
    if (q) out.segments.push(`당분기 컨센 EPS ${q}`);
    out.special.push(
      "컨센 상·하향은 실적·가이던스·매크로 반영 또는 애널 모델 수정이 원인일 수 있습니다.",
    );
    out.special.push(
      "목표가·투자의견 변경이 같은 시점에 있는지 Yahoo Analysis·리포트 헤더를 확인하세요.",
    );
    out.balance.push(
      "컨센 카드만으로는 현금·부채·CapEx를 특정하지 않습니다. 최근 10-Q와 함께 보세요.",
    );
    out.risks.push(
      chg && Number(m?.consensusChangePct) <= -2
        ? "컨센 하향이 이어지면 실적 시즌 전 추가 하향·목표가 조정 위험이 커집니다."
        : "컨센만 움직이고 실적 가시성이 없으면 변동성만 키울 수 있습니다.",
    );
  } else if (kind === "governance") {
    out.segments.push(
      `${sym} 거버넌스·Proxy 공시(${f || title || "DEF 14A"})입니다. 실적 세그먼트표가 목적이 아닙니다.`,
    );
    if (about) out.segments.push(about);
    if (title) out.segments.push(`제목: ${title.slice(0, 140)}`);
    out.special.push(
      "임원 보수·스톡·희석, 이사회 구성, 주주제안, 배당·자사주 승인 여부를 원문 안건 목록에서 확인하세요.",
    );
    out.balance.push(
      "자본배분(배당·자사주) 안건이 있으면 환원 규모·기간이 밸류에이션에 영향을 줍니다.",
    );
    out.risks.push(
      "보수·희석·관련 당사자 거래·주주제안 부결/가결이 거버넌스 리스크 포인트입니다.",
    );
  } else {
    // earnings / 10-Q style without filing text
    out.segments.push(
      `${sym} ${f || "실적"} 카드입니다. EDGAR 본문이 없어 세그먼트 표 숫자를 직접 읽지 못했습니다.`,
    );
    if (vs) {
      out.segments.push(
        `확정 실적 vs 컨센 ${vs}` +
          (m?.vsConsensusLabel ? ` — ${m.vsConsensusLabel}` : ""),
      );
    }
    if (yoy) {
      out.segments.push(
        `성장 ${yoy}` + (m?.yoyLabel ? ` — ${m.yoyLabel}` : ""),
      );
    }
    if (rep && q) out.segments.push(`확정 EPS ${rep} / 분기 컨센 ${q}`);
    out.special.push(
      "10-Q/8-K 원문에서 매출·영업이익·순이익·EPS, 기타이익, CapEx, 인수 금액을 확인하세요.",
    );
    out.special.push(
      "순이익이 영업이익과 크게 다르면 평가이익·일회성 항목 분리 여부가 핵심입니다.",
    );
    out.balance.push(
      "현금·부채·FCF·백로그는 EDGAR 대차대조표·현금흐름표가 필요합니다. 카드의 EDGAR 링크를 여세요.",
    );
    if (fwd || trail) {
      out.balance.push(
        `참고 Yahoo EPS — 트레일링 ${trail || "—"} / 전방 ${fwd || "—"}`,
      );
    }
    out.risks.push(
      "실적 Beat여도 가이던스 톤이 약하면 주가가 약할 수 있습니다. Miss면 일회성 여부·다음 가이던스를 확인하세요.",
    );
  }

  const interp = String(args.interpretation ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^근거:/.test(s));
  out.takeaways.push(...interp.slice(0, 8));
  if (!out.takeaways.length && vs) {
    out.takeaways.push(
      `${sym} 컨센 대비 ${vs} — 숫자 괴리의 원인(가이던스/실적/컨센 스냅)을 원문과 함께 보세요.`,
    );
  }

  return out;
}

/**
 * 10-Q/10-K·실적 수준의 긴 한글 상세 분석 (섹션 ## 헤더 + 목차)
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
  const facts = extractConcreteFilingFacts(filingText);
  const excerpts = pickFilingExcerpts(filingText, kind, isEarningsDoc ? 12 : 6);
  const fill = buildMetricDrivenSectionFills({
    kind,
    symbol: sym,
    form,
    title,
    about,
    numbersBrief,
    interpretation,
    metrics,
  });
  const m = metrics && typeof metrics === "object" ? metrics : null;

  /** @type {string[]} */
  const sections = [];

  /**
   * @param {string[]} lines
   * @param {string} emptyMsg
   */
  const bulletBlock = (lines, emptyMsg) => {
    const uniq = [];
    for (const s of lines) {
      const t = String(s ?? "").trim();
      if (!t) continue;
      if (uniq.some((x) => x.slice(0, 36) === t.slice(0, 36))) continue;
      uniq.push(t);
    }
    if (uniq.length) {
      return uniq.map((s, i) => `${i + 1}. ${s}`).join("\n");
    }
    return emptyMsg;
  };

  /**
   * @param {string[]} primary
   * @param {string[]} fallback
   */
  const mergeLines = (primary, fallback) => {
    /** @type {string[]} */
    const out = [...primary];
    for (const s of fallback) {
      if (!out.some((x) => x.slice(0, 32) === String(s).slice(0, 32))) {
        out.push(s);
      }
    }
    return out;
  };

  sections.push("## 목차");
  sections.push(DEEP_TOC_ITEMS.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  sections.push("## 한줄 요약");
  /** @type {string[]} */
  const headlineBits = [];
  if (numberLines[0]) headlineBits.push(numberLines[0]);
  if (facts.segments[0]) headlineBits.push(facts.segments[0]);
  if (facts.special[0]) headlineBits.push(facts.special[0]);
  if (!headlineBits.length && fill.numbers[0]) headlineBits.push(fill.numbers[0]);
  if (!headlineBits.length && fill.numbers[1]) headlineBits.push(fill.numbers[1]);
  const summaryLead = `${sym} ${f || title || kind} 공시입니다. ${about}`;
  if (headlineBits.length) {
    sections.push(
      `${summaryLead}\n핵심 숫자·포인트: ${headlineBits.slice(0, 5).join(" · ")}.`,
    );
  } else {
    sections.push(
      `${summaryLead} 아래에서 Yahoo 지표·공시 메타·(있으면) EDGAR 추출을 항목별로 정리합니다.`,
    );
  }
  if (!hasFilingText) {
    sections.push(
      "참고: 이번 분석은 EDGAR HTML 본문 수집이 안 된 상태라 Yahoo·카드 지표 비중이 큽니다. EDGAR 링크 원문으로 숫자를 반드시 재확인하세요.",
    );
  }

  sections.push("## 핵심 실적·수치");
  /** @type {string[]} */
  const metricBits = [];
  if (m) {
    const vs = fmtPct(/** @type {number|null} */ (m.vsConsensusPct));
    const yoy = fmtPct(/** @type {number|null} */ (m.yoyPct));
    const chg = fmtPct(/** @type {number|null} */ (m.consensusChangePct));
    const rep = fmtNum(/** @type {number|null} */ (m.reportedEps));
    const fwd = fmtNum(/** @type {number|null} */ (m.consensusEps));
    const q = fmtNum(/** @type {number|null} */ (m.quarterConsensusEps));
    const trail = fmtNum(/** @type {number|null} */ (m.trailingEps));
    const guide = fmtNum(/** @type {number|null} */ (m.guidanceEps));
    if (guide) metricBits.push(`가이던스 EPS ${guide}`);
    if (rep) metricBits.push(`Yahoo 최근 확정 EPS ${rep}`);
    if (q) metricBits.push(`당분기 컨센 EPS ${q}`);
    if (fwd) metricBits.push(`전방 컨센 EPS ${fwd}`);
    if (trail) metricBits.push(`트레일링 EPS ${trail}`);
    if (vs) {
      metricBits.push(
        `컨센 대비 ${vs}${m.vsConsensusLabel ? ` — ${m.vsConsensusLabel}` : ""}`,
      );
    }
    if (yoy) {
      metricBits.push(
        `전년 대비 ${yoy}${m.yoyLabel ? ` — ${m.yoyLabel}` : ""}`,
      );
    }
    if (chg) metricBits.push(`컨센 변동 ${chg}`);
  }
  const numUnique = mergeLines(
    [
      ...metricBits,
      ...numberLines.map((l) => (l.startsWith("공시") ? l : `공시: ${l}`)),
      ...facts.extras,
    ],
    fill.numbers,
  );
  sections.push(
    bulletBlock(
      numUnique.slice(0, 18),
      "표시할 EPS·컨센·가이던스 수치가 카드에도 없습니다.",
    ),
  );

  sections.push("## 사업·세그먼트 포인트");
  /** @type {string[]} */
  const segLines = [...facts.segments];
  if (segLines.length < 4) {
    for (const ex of excerpts) {
      if (
        !/cloud|youtube|search|segment|advertis|subscription|revenue|operating|guidance|outlook/i.test(
          ex,
        )
      ) {
        continue;
      }
      const ko = koSummarizeFilingSentence(ex);
      if (ko && !segLines.some((x) => x.slice(0, 28) === ko.slice(0, 28))) {
        segLines.push(ko);
      }
      if (segLines.length >= 10) break;
    }
  }
  sections.push(
    bulletBlock(
      mergeLines(segLines, fill.segments).slice(0, 14),
      "사업·세그먼트 설명을 구성하지 못했습니다.",
    ),
  );

  sections.push("## 특이 항목 (기타이익·투자·CapEx·M&A)");
  sections.push(
    bulletBlock(
      mergeLines(facts.special, fill.special).slice(0, 14),
      "특이 항목을 구성하지 못했습니다.",
    ),
  );

  sections.push("## 재무상태·현금흐름");
  sections.push(
    bulletBlock(
      mergeLines(facts.balance, fill.balance).slice(0, 12),
      "재무·현금흐름 항목을 구성하지 못했습니다.",
    ),
  );

  sections.push("## 리스크·소송·규제");
  sections.push(
    bulletBlock(
      mergeLines(facts.risks, fill.risks).slice(0, 12),
      "리스크 항목을 구성하지 못했습니다.",
    ),
  );

  sections.push("## 해석·투자 관점");
  /** @type {string[]} */
  const takeaways = [];
  if (facts.segments.some((s) => /Cloud|\+\d/.test(s))) {
    takeaways.push(
      `성장 축: ${facts.segments.find((s) => /Cloud|\+\d/.test(s))}`,
    );
  }
  if (facts.special.some((s) => /평가|기타이익|CapEx|인수/.test(s))) {
    takeaways.push(
      `왜곡·투자 포인트: ${facts.special.find((s) => /평가|기타이익|CapEx|인수/.test(s))}`,
    );
  }
  if (facts.risks[0]) takeaways.push(`규제 리스크: ${facts.risks[0]}`);
  takeaways.push(...fill.takeaways);
  const interp = String(interpretation || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^근거:/.test(s) && !isFilingNoise(s));
  for (const p of interp) {
    if (!takeaways.some((x) => x.slice(0, 40) === p.slice(0, 40))) {
      takeaways.push(p);
    }
  }
  if (article && takeaways.length < 3) {
    for (const p of String(article)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s && !isFilingNoise(s))
      .slice(0, 6)) {
      if (!takeaways.some((x) => x.slice(0, 40) === p.slice(0, 40))) {
        takeaways.push(p);
      }
    }
  }
  sections.push(
    bulletBlock(
      takeaways.slice(0, 14),
      "해석 문장을 구성하지 못했습니다.",
    ),
  );

  sections.push("## 근거");
  if (hasFilingText) {
    sections.push(
      `EDGAR${f ? ` (${f})` : ""} 평문 추출 + Yahoo 메트릭을 함께 썼습니다. 표 단위 확정치는 원문 표를 우선하세요.`,
    );
  } else {
    sections.push(
      `EDGAR HTML 본문은 이번  enrichment에서 수집되지 않았습니다. Yahoo 메트릭·카드 요지(${kind}/${f || title || "—"})로 섹션을 채웠습니다. 카드의 EDGAR·Yahoo 링크에서 원문 숫자를 재확인하세요.`,
    );
  }

  return sanitizeDeepAnalysisKo(sections.join("\n\n"));
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

  const rulesDeep = deepAnalysis;
  let engine = filingFetchOk ? "edgar+rules" : "metrics+rules";
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (key && (text || cardLike.metrics)) {
    try {
      const systemDeep = filingFetchOk
        ? 'Reply in Korean JSON only (no English body): {"headline":"<=40 chars Korean","about":"2 Korean sentences","numbers":"Korean bullets with concrete $/% figures \\n","interpretation":"2-4 Korean judgments with numbers","article":"5-8 Korean paragraphs \\n\\n","deepAnalysis":"Korean investor brief. MUST start with ## 목차 then ## 한줄 요약, ## 핵심 실적·수치, ## 사업·세그먼트 포인트, ## 특이 항목 (기타이익·투자·CapEx·M&A), ## 재무상태·현금흐름, ## 리스크·소송·규제, ## 해석·투자 관점, ## 근거. EVERY section after 목차 must list concrete facts from the filing: dollar amounts, %, segment names, deal names, lawsuit parties — like a detailed 10-Q memo. Do NOT write vague advice such as 확인하세요 without numbers. Do NOT paste English TOC/checkboxes/raw EDGAR. Separate with \\n\\n."}'
        : 'Reply in Korean JSON only: {"headline":"<=40 chars Korean","about":"2 Korean sentences","numbers":"Korean bullets from Yahoo metrics with figures","interpretation":"2-4 Korean judgments with numbers","article":"5-8 Korean paragraphs using metrics","deepAnalysis":"## 목차 then same ## sections. EDGAR body is MISSING — fill EVERY section using Yahoo metrics JSON and the draft outline (guidance vs consensus, EPS, YoY). NEVER write empty fillers like 못 찾았습니다 / 특정하지 못했습니다. Explain what 8-K/guidance cards typically mean when segment tables are absent. Korean only."}';
      const systemShort = filingFetchOk
        ? 'Reply in Korean JSON only: {"headline":"<=40 chars","about":"2 Korean sentences","numbers":"Korean bullets with figures","interpretation":"2-4 Korean judgments with numbers","article":"5-8 Korean paragraphs with concrete facts","deepAnalysis":"## 목차 then same ## sections; each section must cite concrete $/%/names from filing; no vague filler; no English dump."}'
        : 'Reply in Korean JSON only: {"headline":"<=40 chars","about":"2 Korean sentences","numbers":"Korean bullets from metrics","interpretation":"2-4 Korean judgments","article":"5-8 Korean paragraphs","deepAnalysis":"## sections filled from Yahoo metrics; no empty 못 찾음 fillers."}';
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
          max_tokens: wantsDeep ? 4200 : 2000,
          messages: [
            {
              role: "system",
              content: wantsDeep ? systemDeep : systemShort,
            },
            {
              role: "user",
              content: filingFetchOk
                ? `Symbol ${symbol} form ${form} kind ${kind} title ${title}
Yahoo/metrics JSON: ${JSON.stringify(cardLike.metrics || {})}
Draft about: ${about}
Draft numbers: ${numbersBrief}
Draft interpretation: ${interpretation}
Draft article (improve into natural Korean prose grounded in filing): ${article.slice(0, 2500)}
Draft deepAnalysis outline (improve; keep ## headings): ${deepAnalysis.slice(0, wantsDeep ? 4500 : 2000)}
EDGAR plain text (primary source — stay faithful):
${text.slice(0, wantsDeep ? 36000 : 14000)}
Yahoo link: ${cardLike.yahooUrl || ""}
Write deepAnalysis with MANY concrete figures from the EDGAR text (revenues by segment, opex, OI&E, capex, cash, debt, backlog, M&A amounts, legal fines). Korean only.`
                : `Symbol ${symbol} form ${form} kind ${kind} title ${title}
EDGAR body MISSING — use Yahoo metrics + draft only. Do NOT say 못 찾았습니다.
Yahoo/metrics JSON: ${JSON.stringify(cardLike.metrics || {})}
Draft about: ${about}
Draft numbers: ${numbersBrief}
Draft interpretation: ${interpretation}
Draft article: ${article.slice(0, 2500)}
Draft deepAnalysis (KEEP its concrete bullets; expand in Korean): ${deepAnalysis.slice(0, wantsDeep ? 4500 : 2000)}
Yahoo link: ${cardLike.yahooUrl || ""}
Output deepAnalysis with concrete EPS/%/guidance numbers in every major section.`,
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
            deepAnalysis = sanitizeDeepAnalysisKo(
              String(parsed.deepAnalysis),
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

  deepAnalysis = sanitizeDeepAnalysisKo(deepAnalysis);

  if (
    !deepAnalysis ||
    deepAnalysis.length < 200 ||
    isThinDeepAnalysis(deepAnalysis)
  ) {
    deepAnalysis = sanitizeDeepAnalysisKo(
      rulesDeep && !isThinDeepAnalysis(rulesDeep)
        ? rulesDeep
        : buildDeepAnalysisFromFiling({
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
          }),
    );
    if (engine.includes("openai")) {
      engine = filingFetchOk ? "edgar+rules" : "metrics+rules";
    }
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
