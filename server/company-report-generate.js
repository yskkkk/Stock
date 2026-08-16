/**
 * 기업 심층 보고서 생성 — 재무·야후 팩·공시·(선택) OpenAI 한글로 목차형 보고서
 */
import { isKrQuoteSymbol, yahooSymbolToKrCode } from "./kr-naver-quote.js";
import { resolveDisplayName } from "./names-ko.js";
import { loadStockFundamentals } from "./stock-fundamentals.js";
import {
  loadFinancialPeriods,
  loadFinancialStatementDetail,
} from "./stock-financials.js";
import {
  fetchYahooCompanyReportPack,
  flattenYahooReportFacts,
} from "./company-report-yahoo-pack.js";
import {
  fetchRecentSecFilingsForSymbol,
} from "./us-announcement-edgar.js";
import { fetchYahooConsensusSnapshot } from "./us-announcement-consensus.js";
import { fetchDartDisclosures } from "./dart.js";
import { localizeIndustry } from "./stock-vault-meta.js";
import { upsertCompanyReport } from "./company-report-store.js";
import { loadEnvFile } from "./load-env.js";

loadEnvFile();

export const COMPANY_REPORT_VERSION = 4;

export const COMPANY_REPORT_TOC = [
  "한줄 요약·투자 포인트",
  "회사 개요·성장 스토리",
  "사업·제품·세그먼트",
  "경영진·조직",
  "매출·성장 추이",
  "수익성·마진·ROE",
  "재무상태·건전성",
  "현금흐름·투자·잉여현금",
  "밸류에이션·배수",
  "주주환원·배당·자사주",
  "시총·유통주식·공매도",
  "내부자·기관 지분",
  "애널리스트·목표가·컨센",
  "최근 실적·가이던스·일정",
  "공시·SEC·이슈",
  "ESG·규제·리스크",
  "산업·경쟁 포지션",
  "미래 전망·시나리오",
  "데이터 근거·한계",
];

/** @param {number | null | undefined} n @param {number} [d] */
function fmtN(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ko-KR", {
    maximumFractionDigits: d,
    minimumFractionDigits: 0,
  });
}

/** @param {number | null | undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  // Yahoo often 0.12 = 12%
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * 금액 — 한글 단위 (조원/억원/원, 조달러/억달러/만달러/달러)
 * @param {number | null | undefined} n
 * @param {string} [ccy]
 */
function fmtMoney(n, ccy = "USD") {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (String(ccy).toUpperCase() === "KRW") {
    if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}조원`;
    if (v >= 1e8) return `${sign}${(v / 1e8).toFixed(1)}억원`;
    if (v >= 1e4) return `${sign}${Math.round(v / 1e4).toLocaleString("ko-KR")}만원`;
    return `${sign}${Math.round(v).toLocaleString("ko-KR")}원`;
  }
  // USD: 1조달러=1e12, 1억달러=1e8, 1만달러=1e4
  if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}조달러`;
  if (v >= 1e8) return `${sign}${(v / 1e8).toFixed(1)}억달러`;
  if (v >= 1e4) return `${sign}${Math.round(v / 1e4).toLocaleString("ko-KR")}만달러`;
  return `${sign}${fmtN(v)}달러`;
}

/** 주가·목표가·EPS 등 소액 — 항상 단위 포함 */
function fmtPx(n, ccy = "USD") {
  if (n == null || !Number.isFinite(n)) return "—";
  if (String(ccy).toUpperCase() === "KRW") {
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
  }
  return `${fmtN(n)}달러`;
}

/** @param {number | null | undefined} n */
function fmtShares(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (v >= 1e12) return `${sign}${(v / 1e12).toFixed(2)}조주`;
  if (v >= 1e8) return `${sign}${(v / 1e8).toFixed(1)}억주`;
  if (v >= 1e4) return `${sign}${(v / 1e4).toFixed(0)}만주`;
  return `${sign}${fmtN(v, 0)}주`;
}

/** @param {unknown} raw */
function koIndustryLabel(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "—";
  if (/[가-힣]/.test(t)) return t;
  const ko = localizeIndustry(t);
  return ko && ko !== "기타" ? ko : t;
}

/** @param {unknown} key */
function koRec(key) {
  const k = String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  /** @type {Record<string, string>} */
  const map = {
    strong_buy: "강력매수",
    buy: "매수",
    hold: "보유",
    sell: "매도",
    strong_sell: "강력매도",
    underperform: "비중축소",
    outperform: "비중확대",
    none: "없음",
  };
  return map[k] || String(key ?? "");
}

/** @param {unknown} raw */
function koCountry(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  /** @type {Record<string, string>} */
  const map = {
    "United States": "미국",
    USA: "미국",
    US: "미국",
    "United Kingdom": "영국",
    UK: "영국",
    Japan: "일본",
    China: "중국",
    "South Korea": "한국",
    Korea: "한국",
    Germany: "독일",
    France: "프랑스",
    Canada: "캐나다",
    Taiwan: "대만",
    India: "인도",
    Australia: "호주",
    Netherlands: "네덜란드",
    Switzerland: "스위스",
    Ireland: "아일랜드",
    Israel: "이스라엘",
    Brazil: "브라질",
  };
  return map[t] || t;
}

/** @param {unknown} raw */
function koExchange(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const u = t.toUpperCase();
  if (/NASDAQ/.test(u)) return "나스닥";
  if (/NYSE|NEW YORK/.test(u)) return "뉴욕거래소";
  if (/AMEX|NYSE MKT|NYSE AMERICAN/.test(u)) return "아멕스";
  if (/KSC|KRX|KOSPI|\.KS/.test(u)) return "코스피";
  if (/KOE|KOSDAQ|\.KQ/.test(u)) return "코스닥";
  return t;
}

/** @param {unknown} title */
function koOfficerTitle(title) {
  let t = String(title ?? "").trim();
  if (!t) return "";
  t = t
    .replace(/\bChief Executive Officer\b/gi, "최고경영자")
    .replace(/\bChief Financial Officer\b/gi, "최고재무책임자")
    .replace(/\bChief Operating Officer\b/gi, "최고운영책임자")
    .replace(/\bChief Technology Officer\b/gi, "최고기술책임자")
    .replace(/\bGeneral Counsel\b/gi, "법률총괄")
    .replace(/\bPrincipal Accounting Officer\b/gi, "회계책임자")
    .replace(/\bDirector of Investor Relations\b/gi, "IR 담당")
    .replace(/\bSenior Vice President\b/gi, "수석부사장")
    .replace(/\bVice President\b/gi, "부사장")
    .replace(/\bSenior VP\b/gi, "수석부사장")
    .replace(/\bCEO\b/g, "최고경영자(CEO)")
    .replace(/\bCFO\b/g, "최고재무책임자(CFO)")
    .replace(/\bCOO\b/g, "최고운영책임자(COO)")
    .replace(/\bDirector\b/gi, "이사")
    .replace(/\bSecretary\b/gi, "서기")
    .replace(/\bRetail & People\b/gi, "리테일·인사")
    .replace(/\bGovernment Affairs\b/gi, "대관")
    .replace(/\bWorldwide Marketing\b/gi, "글로벌 마케팅")
    .replace(/\bWorldwide Communications\b/gi, "글로벌 커뮤니케이션");
  return t;
}

/** @param {unknown} form */
function koFilingForm(form) {
  const f = String(form ?? "").trim().toUpperCase();
  if (f === "10-K") return "연차보고서(10-K)";
  if (f === "10-Q") return "분기보고서(10-Q)";
  if (f === "8-K") return "수시공시(8-K)";
  if (f === "20-F") return "해외기업 연차(20-F)";
  if (f === "6-K") return "해외기업 수시(6-K)";
  if (f === "DEF 14A" || f === "DEF14A") return "위임장설명서(DEF 14A)";
  if (f === "DEFA14A") return "추가 위임장(DEFA14A)";
  if (f === "DART") return "전자공시(DART)";
  return String(form ?? "");
}

/** @param {unknown} grade */
function koGrade(grade) {
  const g = String(grade ?? "").trim();
  if (!g) return "—";
  const low = g.toLowerCase();
  if (/strong\s*buy/.test(low)) return "강력매수";
  if (/strong\s*sell/.test(low)) return "강력매도";
  if (/\bbuy\b|overweight|outperform/.test(low)) return "매수";
  if (/\bhold\b|neutral|equal.?weight|market\s*perform/.test(low)) return "보유";
  if (/\bsell\b|underweight|underperform/.test(low)) return "매도";
  return g;
}

/** @param {unknown} action */
function koAction(action) {
  const a = String(action ?? "").trim().toLowerCase();
  if (!a) return "변경";
  if (a.includes("upgrade") || a === "up") return "상향";
  if (a.includes("downgrade") || a === "down") return "하향";
  if (a.includes("init")) return "개시";
  if (a.includes("maintain") || a.includes("reiterat")) return "유지";
  return String(action);
}

function looksMostlyEnglish(text) {
  const t = String(text ?? "").trim();
  if (t.length < 40) return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const hangul = (t.match(/[가-힣]/g) || []).length;
  return latin > 80 && hangul < latin * 0.15;
}

/**
 * 번역 키 없을 때 — 구조화 팩트로 한글 성장·개요 문단 구성
 * @param {Record<string, unknown>} facts
 * @param {string} name
 * @param {string} ccy
 */
function buildKoreanGrowthStoryFallback(facts, name, ccy) {
  /** @type {string[]} */
  const parts = [];
  const sector = koIndustryLabel(facts.sector);
  const industry = koIndustryLabel(facts.industry);
  const field = [sector, industry].filter((x) => x && x !== "—").join(" · ");
  if (field) {
    parts.push(`${name}은(는) ${field} 분야의 기업이다.`);
  }
  if (facts.totalRevenue != null) {
    parts.push(
      `최근 12개월 매출은 ${fmtMoney(/** @type {number} */ (facts.totalRevenue), ccy)} 규모다.`,
    );
  }
  if (facts.revenueGrowth != null) {
    const g = Number(facts.revenueGrowth);
    parts.push(
      `매출 성장률은 ${fmtPct(g)}로, ${
        g >= 0.15 ? "고성장" : g > 0 ? "완만 성장" : "역성장·둔화"
      } 구간에 해당한다.`,
    );
  }
  if (facts.profitMargins != null) {
    parts.push(`순이익률은 ${fmtPct(/** @type {number} */ (facts.profitMargins))}다.`);
  }
  if (facts.marketCap != null) {
    parts.push(`시가총액은 ${fmtMoney(/** @type {number} */ (facts.marketCap), ccy)}다.`);
  }
  if (facts.fullTimeEmployees != null) {
    parts.push(
      `임직원은 약 ${fmtN(/** @type {number} */ (facts.fullTimeEmployees), 0)}명이다.`,
    );
  }
  const hq = [facts.city, koCountry(facts.country)].filter(Boolean).join(", ");
  if (hq) parts.push(`본사는 ${hq}에 있다.`);
  if (facts.website) parts.push(`웹사이트는 ${facts.website}이다.`);
  return parts.join(" ");
}

/**
 * 영문 사업개요 등 → 한글 (OpenAI 있을 때만)
 * @param {string} text
 */
async function translatePassageToKorean(text) {
  const raw = String(text ?? "").trim();
  if (!raw || !looksMostlyEnglish(raw)) return raw;
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) {
    // 영문 장문 그대로 넣지 않음 — 한글 번역 키가 있을 때만 사업개요 문단 생성
    return "";
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(
          process.env.STOCK_COMPANY_REPORT_LLM_MODEL ??
            process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ??
            "gpt-4o-mini",
        ).trim(),
        temperature: 0.2,
        max_tokens: 1800,
        messages: [
          {
            role: "system",
            content:
              "Translate the company business description into natural Korean for an equity report. Keep product names (iPhone 등). No English paragraphs. No preamble.",
          },
          { role: "user", content: raw.slice(0, 3500) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return raw;
    const data = await res.json();
    const out = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (out.length < 80 || looksMostlyEnglish(out)) return raw;
    return out.slice(0, 4000);
  } catch {
    return raw;
  }
}

/**
 * @param {string[]} lines
 * @param {string} empty
 */
function bullets(lines, empty) {
  const uniq = [];
  for (const s of lines) {
    const t = String(s ?? "").trim();
    if (!t) continue;
    if (isMetaAdviceLine(t)) continue;
    if (uniq.some((x) => x.slice(0, 40) === t.slice(0, 40))) continue;
    uniq.push(t);
  }
  if (!uniq.length) return empty;
  return uniq.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

/** 「어떻게 보라」 메타·숙제 톤 — 기업 사실 문장이 아님 */
function isMetaAdviceLine(line) {
  const t = String(line ?? "").trim();
  if (!t) return true;
  return (
    /확인하세요|대조하세요|함께 보세요|열어보세요|재확인하세요|확인해야|우선하세요|별도 확인|교차하세요|가늠합니다|가늠하세요|가정해 해석|해석하세요|봐야 합니다|점검이 필요|점검하세요|관찰$|관찰하세요|숙제|원문에서 확인|원문과 함께|우선 참고하세요|최종 기준으로 하세요|함께 해석합니다|가중치가 다릅니다|시나리오를 구성|가설을 세워|동력이 될 수 |톤이 우선|전제 가정이 핵심|이미 반영 여부/.test(
      t,
    ) ||
    /업종별로 가중치|업종 공통 리스크를 가정|재무 탭·피어|별도로 확인하세요|이번 보고서는 재무·시세 팩 중심|세그먼트별 매출 표는 10-Q|자사주 매입 규모는 현금흐름표|가이던스 레인지·톤은 최근|베이스: 컨센·가이던스 달성/.test(
      t,
    )
  );
}

/**
 * @param {string} body
 */
function stripMetaAdviceFromBody(body) {
  return String(body ?? "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^##\s/.test(t)) return true;
      const bare = t.replace(/^\d+[.)]\s*/, "").trim();
      return !isMetaAdviceLine(bare);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 숫자로 이 기업에 대한 결론 문장 생성
 * @param {Record<string, unknown>} facts
 * @param {string} name
 * @param {string} ccy
 */
/**
 * 재무표 셀 → 숫자 (콤마·한글 단위 문자열 대응)
 * @param {unknown} raw
 * @param {string} [unitNote]
 */
function parseStatementMoney(raw, unitNote = "") {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw ?? "").trim();
  if (!s || s === "—") return null;
  const note = String(unitNote ?? "");
  let n = Number(s.replace(/,/g, "").replace(/[^\d.\-eE]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (/억원/.test(note) || /억원/.test(s)) n *= 1e8;
  else if (/조원/.test(note) || /조원/.test(s)) n *= 1e12;
  else if (/백만원|백만/.test(note)) n *= 1e6;
  return n;
}

/**
 * @param {Awaited<ReturnType<typeof loadFinancialStatementDetail>>} detail
 */
function extractPeriodMoneyMetrics(detail) {
  /** @type {{ revenue: number|null; opIncome: number|null; netIncome: number|null; grossProfit: number|null }} */
  const out = {
    revenue: null,
    opIncome: null,
    netIncome: null,
    grossProfit: null,
  };
  const secs = Array.isArray(detail?.sections) ? detail.sections : [];
  for (const sec of secs) {
    const unitNote = String(sec?.unitNote ?? "");
    const rows = Array.isArray(sec?.rows) ? sec.rows : [];
    for (const row of rows) {
      const label = String(row?.label ?? row?.name ?? "");
      const val = parseStatementMoney(row?.value ?? row?.raw, unitNote);
      if (val == null) continue;
      if (
        /총매출|^매출액$|^revenue$|total revenue|영업수익/i.test(label) &&
        !/원가|비용|채권|cost/i.test(label)
      ) {
        if (out.revenue == null) out.revenue = val;
      } else if (
        /영업이익|operating income/i.test(label) &&
        !/비용|손실전/i.test(label)
      ) {
        if (out.opIncome == null) out.opIncome = val;
      } else if (
        /당기순이익|^순이익$|net income/i.test(label) &&
        !/comprehensive|지배주주|비지배/i.test(label)
      ) {
        if (out.netIncome == null) out.netIncome = val;
      } else if (/매출총이익|gross profit/i.test(label)) {
        if (out.grossProfit == null) out.grossProfit = val;
      }
    }
  }
  return out;
}

/**
 * @param {{
 *   label: string;
 *   kind: string;
 *   revenue: number|null;
 *   opIncome: number|null;
 *   netIncome: number|null;
 * }[]} rows
 * @param {Record<string, unknown>} facts
 * @param {string} ccy
 * @param {string} name
 */
function buildReportCharts(rows, facts, ccy, name) {
  /** @type {Array<{
   *   id: string;
   *   section: string;
   *   title: string;
   *   type: "bar"|"line"|"grouped";
   *   unit: string;
   *   series: Array<{ name: string; points: Array<{ x: string; y: number }> }>;
   * }>} */
  const charts = [];

  const annual = rows
    .filter((r) => r.kind === "annual" && r.revenue != null)
    .slice()
    .reverse();
  const quarter = rows
    .filter((r) => r.kind === "quarter" && r.revenue != null)
    .slice()
    .reverse();

  const revSeries = (annual.length >= 2 ? annual : quarter).filter(
    (r) => r.revenue != null,
  );
  if (revSeries.length >= 2) {
    charts.push({
      id: "revenue-trend",
      section: "매출·성장 추이",
      title: `${name} 매출 추이 (${annual.length >= 2 ? "연간" : "분기"})`,
      type: "bar",
      unit: ccy,
      series: [
        {
          name: "매출",
          points: revSeries.map((r) => ({
            x: r.label,
            y: /** @type {number} */ (r.revenue),
          })),
        },
      ],
    });
  }

  const profitBase = (annual.length >= 2 ? annual : quarter).filter(
    (r) => r.opIncome != null || r.netIncome != null,
  );
  if (profitBase.length >= 2) {
    /** @type {Array<{ name: string; points: Array<{ x: string; y: number }> }>} */
    const series = [];
    if (profitBase.some((r) => r.opIncome != null)) {
      series.push({
        name: "영업이익",
        points: profitBase
          .filter((r) => r.opIncome != null)
          .map((r) => ({
            x: r.label,
            y: /** @type {number} */ (r.opIncome),
          })),
      });
    }
    if (profitBase.some((r) => r.netIncome != null)) {
      series.push({
        name: "당기순이익",
        points: profitBase
          .filter((r) => r.netIncome != null)
          .map((r) => ({
            x: r.label,
            y: /** @type {number} */ (r.netIncome),
          })),
      });
    }
    if (series.length) {
      charts.push({
        id: "profit-trend",
        section: "매출·성장 추이",
        title: `${name} 이익 추이 (${annual.length >= 2 ? "연간" : "분기"})`,
        type: series.length > 1 ? "grouped" : "bar",
        unit: ccy,
        series,
      });
    }
  }

  /** @type {Array<{ x: string; y: number }>} */
  const marginPts = [];
  if (facts.grossMargins != null && Number.isFinite(Number(facts.grossMargins))) {
    const g = Number(facts.grossMargins);
    marginPts.push({
      x: "매출총이익률",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (
    facts.operatingMargins != null &&
    Number.isFinite(Number(facts.operatingMargins))
  ) {
    const g = Number(facts.operatingMargins);
    marginPts.push({
      x: "영업이익률",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (facts.profitMargins != null && Number.isFinite(Number(facts.profitMargins))) {
    const g = Number(facts.profitMargins);
    marginPts.push({
      x: "순이익률",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (facts.returnOnEquity != null && Number.isFinite(Number(facts.returnOnEquity))) {
    const g = Number(facts.returnOnEquity);
    marginPts.push({
      x: "ROE",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (marginPts.length >= 2) {
    charts.push({
      id: "margins",
      section: "수익성·마진·ROE",
      title: `${name} 수익성 지표`,
      type: "bar",
      unit: "pct",
      series: [{ name: "비율", points: marginPts }],
    });
  }

  /** @type {Array<{ x: string; y: number }>} */
  const growthPts = [];
  if (facts.revenueGrowth != null && Number.isFinite(Number(facts.revenueGrowth))) {
    const g = Number(facts.revenueGrowth);
    growthPts.push({
      x: "매출성장",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (
    facts.earningsGrowth != null &&
    Number.isFinite(Number(facts.earningsGrowth))
  ) {
    const g = Number(facts.earningsGrowth);
    growthPts.push({
      x: "이익성장",
      y: Math.abs(g) <= 1.5 ? g * 100 : g,
    });
  }
  if (growthPts.length >= 1) {
    charts.push({
      id: "growth-rates",
      section: "매출·성장 추이",
      title: `${name} 성장률`,
      type: "bar",
      unit: "pct",
      series: [{ name: "성장률", points: growthPts }],
    });
  }

  return charts;
}

function analyzeCompanyFindings(facts, name, ccy) {
  /** @type {string[]} */
  const risk = [];
  /** @type {string[]} */
  const industry = [];
  /** @type {string[]} */
  const outlook = [];
  /** @type {string[]} */
  const cash = [];

  if (facts.operatingCashflow != null && facts.freeCashflow != null) {
    const ocf = Number(facts.operatingCashflow);
    const fcf = Number(facts.freeCashflow);
    if (Number.isFinite(ocf) && Number.isFinite(fcf) && ocf !== 0) {
      const conv = (fcf / ocf) * 100;
      const drain = ocf - fcf;
      cash.push(
        `${name} 영업현금흐름 ${fmtMoney(ocf, ccy)} · 잉여현금흐름 ${fmtMoney(fcf, ccy)} · 전환율 ${conv.toFixed(0)}%`,
      );
      if (drain > 0) {
        cash.push(
          `영업현금 대비 잉여현금 차감분(투자성) 약 ${fmtMoney(drain, ccy)}`,
        );
      } else if (drain < 0) {
        cash.push(
          `잉여현금이 영업현금을 상회 — 운전자본·일회성 유입 영향 가능 (${fmtMoney(Math.abs(drain), ccy)})`,
        );
      }
    }
  } else {
    if (facts.operatingCashflow != null) {
      cash.push(`영업현금흐름 ${fmtMoney(/** @type {number} */ (facts.operatingCashflow), ccy)}`);
    }
    if (facts.freeCashflow != null) {
      cash.push(`잉여현금흐름 ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)}`);
    }
  }

  if (facts.esgTotal != null) {
    risk.push(
      `${name} ESG 종합 ${fmtN(/** @type {number} */ (facts.esgTotal))} (환경 ${fmtN(/** @type {number|null} */ (facts.esgEnvironment))} / 사회 ${fmtN(/** @type {number|null} */ (facts.esgSocial))} / 지배구조 ${fmtN(/** @type {number|null} */ (facts.esgGovernance))})`,
    );
  }
  if (facts.shortPercentOfFloat != null) {
    const sp = Number(facts.shortPercentOfFloat);
    const pct = Math.abs(sp) <= 1.5 ? sp * 100 : sp;
    risk.push(
      `${name} 유통주식 대비 공매도 ${fmtPct(sp)}${
        pct >= 10
          ? ` · days to cover ${fmtN(/** @type {number|null} */ (facts.shortRatio))} — 숏 포지션 비중이 큼`
          : pct >= 5
            ? " — 공매도 비중 중간 수준"
            : " — 공매도 비중은 낮은 편"
      }`,
    );
  }
  if (facts.debtToEquity != null) {
    const de = Number(facts.debtToEquity);
    risk.push(
      `${name} D/E ${fmtN(de)}${
        de > 200
          ? " — 레버리지가 높은 편"
          : de > 100
            ? " — 레버리지 중간~높음"
            : " — 레버리지 부담은 상대적으로 낮음"
      }`,
    );
  }
  if (facts.currentRatio != null) {
    const cr = Number(facts.currentRatio);
    risk.push(
      `유동비율 ${fmtN(cr)}${cr < 1 ? " — 단기 유동성 압박 가능" : cr < 1.5 ? " — 단기 유동성은 보통" : " — 단기 유동성 여유"}`,
    );
  }
  if (facts.beta != null) {
    const b = Number(facts.beta);
    risk.push(
      `베타 ${fmtN(b)}${b >= 1.3 ? " — 시장 대비 변동성 큼" : b <= 0.8 ? " — 시장 대비 변동성 낮음" : ""}`,
    );
  }

  if (facts.sector || facts.industry) {
    industry.push(
      `${name} 소속: ${[koIndustryLabel(facts.sector), koIndustryLabel(facts.industry)].filter((x) => x && x !== "—").join(" > ")}`,
    );
  }
  if (facts.profitMargins != null) {
    const m = Number(facts.profitMargins);
    industry.push(
      `순이익률 ${fmtPct(m)}${
        m >= 0.2
          ? ` — ${name}은 고마진 구조`
          : m >= 0.08
            ? " — 보통 수준 마진"
            : m > 0
              ? " — 박리 마진"
              : " — 적자 또는 무마진"
      }`,
    );
  }
  if (facts.grossMargins != null) {
    industry.push(`매출총이익률 ${fmtPct(/** @type {number} */ (facts.grossMargins))}`);
  }
  if (facts.operatingMargins != null) {
    industry.push(`영업이익률 ${fmtPct(/** @type {number} */ (facts.operatingMargins))}`);
  }
  if (facts.revenueGrowth != null) {
    const g = Number(facts.revenueGrowth);
    industry.push(
      `매출 성장률 ${fmtPct(g)}${
        g >= 0.15
          ? ` — ${name} 고성장 구간`
          : g > 0
            ? " — 완만 성장"
            : " — 매출 역성장/둔화"
      }`,
    );
  }
  if (facts.returnOnEquity != null) {
    industry.push(`ROE ${fmtPct(/** @type {number} */ (facts.returnOnEquity))}`);
  }

  if (facts.targetMeanPrice != null && facts.price != null) {
    const upside =
      ((Number(facts.targetMeanPrice) - Number(facts.price)) /
        Number(facts.price)) *
      100;
    outlook.push(
      `${name} 현재가 대비 컨센 목표가 평균 괴리 ${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% (목표가 ${fmtPx(/** @type {number} */ (facts.targetMeanPrice), ccy)})`,
    );
  }
  if (facts.recommendationKey) {
    outlook.push(
      `애널리스트 컨센 투자의견 ${koRec(facts.recommendationKey)}${
        facts.numberOfAnalystOpinions != null
          ? ` · ${fmtN(/** @type {number} */ (facts.numberOfAnalystOpinions), 0)}명`
          : ""
      }`,
    );
  }
  if (facts.revenueGrowth != null || facts.earningsGrowth != null) {
    const bits = [];
    if (facts.revenueGrowth != null) bits.push(`매출 ${fmtPct(/** @type {number} */ (facts.revenueGrowth))}`);
    if (facts.earningsGrowth != null) bits.push(`이익 ${fmtPct(/** @type {number} */ (facts.earningsGrowth))}`);
    outlook.push(`${name} 성장 지표: ${bits.join(" · ")}`);
  }
  if (facts.forwardPE != null || facts.trailingPE != null) {
    outlook.push(
      `밸류: 후행 PER ${fmtN(/** @type {number|null} */ (facts.trailingPE))}배 · 선행 PER ${fmtN(/** @type {number|null} */ (facts.forwardPE))}배`,
    );
  }
  if (facts.freeCashflow != null && Number(facts.freeCashflow) > 0) {
    outlook.push(`${name} 잉여현금흐름(FCF) 흑자 ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)} — 환원·재투자 여력 존재`);
  } else if (facts.freeCashflow != null && Number(facts.freeCashflow) < 0) {
    outlook.push(`${name} 잉여현금흐름(FCF) 적자 ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)} — 현금 창출보다 투자/유출이 큼`);
  }

  return { risk, industry, outlook, cash };
}

/**
 * @param {Record<string, unknown>} facts
 * @param {Awaited<ReturnType<typeof loadStockFundamentals>> | null} fund
 * @param {unknown} _periods
 * @param {unknown} consensus
 * @param {Array<{ form: string; title: string; filedAt: number; url: string }>} filings
 * @param {{ symbol: string; name: string; market: "kr"|"us" }} meta
 * @param {string[]} [periodLines]
 */
function buildRulesBody(facts, fund, _periods, consensus, filings, meta, periodLines = []) {
  const ccy =
    String(facts.currency || fund?.currency || (meta.market === "kr" ? "KRW" : "USD"));
  const name = meta.name;
  const sym = meta.symbol;

  /** @type {string[]} */
  const sections = [];
  sections.push("## 목차");
  sections.push(COMPANY_REPORT_TOC.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  // 1 summary
  sections.push("## 한줄 요약·투자 포인트");
  /** @type {string[]} */
  const headline = [];
  headline.push(
    `${name}(${sym}) · ${koIndustryLabel(facts.sector)} / ${koIndustryLabel(facts.industry)} · ${koExchange(facts.exchange) || (meta.market === "kr" ? "한국" : "미국")}`,
  );
  if (facts.price != null) {
    headline.push(
      `현재가 ${fmtPx(/** @type {number} */ (facts.price), ccy)} · 시총 ${fmtMoney(/** @type {number|null} */ (facts.marketCap ?? fund?.marketCap), ccy)}`,
    );
  } else if (fund?.price != null) {
    headline.push(
      `참고가 ${fmtPx(fund.price, ccy)} · 시총 ${fmtMoney(fund.marketCap, ccy)}`,
    );
  }
  if (facts.trailingPE != null || fund?.per != null) {
    headline.push(
      `후행 PER ${fmtN(/** @type {number|null} */ (facts.trailingPE ?? fund?.per))}배 · 선행 PER ${fmtN(/** @type {number|null} */ (facts.forwardPE ?? fund?.forwardPer))}배`,
    );
  }
  if (facts.revenueGrowth != null || fund?.revenueGrowth != null) {
    headline.push(
      `매출 성장 ${fmtPct(/** @type {number|null} */ (facts.revenueGrowth ?? fund?.revenueGrowth))}`,
    );
  }
  if (facts.recommendationKey) {
    headline.push(
      `컨센 투자의견 ${koRec(facts.recommendationKey)} (점수 ${fmtN(/** @type {number|null} */ (facts.recommendationMean))}, 애널리스트 ${fmtN(/** @type {number|null} */ (facts.numberOfAnalystOpinions), 0)}명)`,
    );
  }
  sections.push(bullets(headline, `${name} 핵심 지표를 충분히 모으지 못함.`));

  // 2 profile
  sections.push("## 회사 개요·성장 스토리");
  /** @type {string[]} */
  const story = [];
  const summaryKo = String(facts.longBusinessSummary ?? "").trim();
  if (summaryKo && !looksMostlyEnglish(summaryKo)) {
    story.push(summaryKo.slice(0, 2800));
    story.push(
      `본사 ${[facts.city, koCountry(facts.country)].filter(Boolean).join(", ") || "—"} · 임직원 ${fmtN(/** @type {number|null} */ (facts.fullTimeEmployees), 0)}명 · 웹사이트 ${facts.website || "—"}`,
    );
  } else {
    const fallback = buildKoreanGrowthStoryFallback(facts, name, ccy);
    if (fallback) story.push(fallback);
  }
  if (facts.longName && facts.longName !== name) {
    story.push(`공식명: ${facts.longName}`);
  }
  sections.push(bullets(story, `${name} 사업 개요 원문을 확보하지 못함.`));

  // 3 business
  sections.push("## 사업·제품·세그먼트");
  sections.push(
    bullets(
      [
        facts.sector ? `${name} 섹터: ${koIndustryLabel(facts.sector)}` : "",
        facts.industry ? `${name} 산업: ${koIndustryLabel(facts.industry)}` : "",
        facts.totalRevenue != null
          ? `${name} 최근 12개월 매출 ${fmtMoney(/** @type {number} */ (facts.totalRevenue), ccy)} · 주당 매출 ${fmtPx(/** @type {number|null} */ (facts.revenuePerShare), ccy)}`
          : "",
      ],
      `${name} 사업·세그먼트 세부 매출 분해가 이번 팩에 없음.`,
    ),
  );

  // 4 officers
  sections.push("## 경영진·조직");
  const officers = Array.isArray(facts.officers) ? facts.officers : [];
  sections.push(
    bullets(
      officers.map((o) => {
        const title = koOfficerTitle(o.title);
        const age =
          o.age != null ? ` (나이 ${fmtN(/** @type {number} */ (o.age), 0)})` : "";
        const pay =
          o.totalPay != null ? ` · 보수 ${fmtMoney(o.totalPay, "USD")}` : "";
        return `${o.name}${title ? ` — ${title}` : ""}${age}${pay}`;
      }),
      `${name} 경영진 명단이 이번 팩에 없음.`,
    ),
  );

  // 5 revenue growth from periods
  sections.push("## 매출·성장 추이");
  /** @type {string[]} */
  const revLines = [...periodLines];
  if (facts.revenueGrowth != null) {
    revLines.unshift(
      `${name} 매출 성장률 ${fmtPct(/** @type {number} */ (facts.revenueGrowth))}`,
    );
  }
  if (facts.earningsGrowth != null) {
    revLines.unshift(
      `${name} 이익 성장률 ${fmtPct(/** @type {number} */ (facts.earningsGrowth))}`,
    );
  }
  sections.push(
    bullets(revLines, `${name} 기간별 매출·성장 수치가 이번 팩에 없음.`),
  );

  // 6 margins
  sections.push("## 수익성·마진·ROE");
  sections.push(
    bullets(
      [
        facts.grossMargins != null
          ? `${name} 매출총이익률 ${fmtPct(/** @type {number} */ (facts.grossMargins))}`
          : "",
        facts.operatingMargins != null
          ? `영업이익률 ${fmtPct(/** @type {number} */ (facts.operatingMargins))}`
          : "",
        facts.profitMargins != null || fund?.profitMargin != null
          ? `순이익률 ${fmtPct(/** @type {number|null} */ (facts.profitMargins ?? fund?.profitMargin))}`
          : "",
        facts.ebitdaMargins != null
          ? `EBITDA 마진 ${fmtPct(/** @type {number} */ (facts.ebitdaMargins))}`
          : "",
        facts.returnOnEquity != null || fund?.roe != null
          ? `ROE ${fmtPct(/** @type {number|null} */ (facts.returnOnEquity ?? fund?.roe))}`
          : "",
        facts.returnOnAssets != null
          ? `ROA ${fmtPct(/** @type {number} */ (facts.returnOnAssets))}`
          : "",
      ],
      `${name} 수익성 지표가 이번 팩에 없음.`,
    ),
  );

  // 7 balance
  sections.push("## 재무상태·건전성");
  /** @type {string[]} */
  const balLines = [
    facts.totalCash != null
      ? `${name} 현금 ${fmtMoney(/** @type {number} */ (facts.totalCash), ccy)}`
      : "",
    facts.totalDebt != null
      ? `총부채 ${fmtMoney(/** @type {number} */ (facts.totalDebt), ccy)}`
      : "",
    facts.debtToEquity != null
      ? `부채비율(D/E) ${fmtN(/** @type {number} */ (facts.debtToEquity))}`
      : "",
    facts.currentRatio != null
      ? `유동비율 ${fmtN(/** @type {number} */ (facts.currentRatio))}`
      : "",
    facts.quickRatio != null
      ? `당좌비율 ${fmtN(/** @type {number} */ (facts.quickRatio))}`
      : "",
    facts.bookValue != null || fund?.bps != null
      ? `BPS ${fmtN(/** @type {number|null} */ (facts.bookValue ?? fund?.bps))}`
      : "",
    facts.enterpriseValue != null
      ? `기업가치(EV) ${fmtMoney(/** @type {number} */ (facts.enterpriseValue), ccy)}`
      : "",
  ];
  if (
    facts.totalCash != null &&
    facts.totalDebt != null &&
    Number.isFinite(Number(facts.totalCash)) &&
    Number.isFinite(Number(facts.totalDebt))
  ) {
    const net = Number(facts.totalCash) - Number(facts.totalDebt);
    balLines.push(
      `순현금(현금−총부채) ${fmtMoney(net, ccy)}${
        net >= 0 ? " — 순현금 상태" : " — 순부채 상태"
      }`,
    );
  }
  sections.push(
    bullets(balLines, `${name} 재무상태 핵심 숫자가 이번 팩에 없음.`),
  );

  const findings = analyzeCompanyFindings(facts, name, ccy);

  // 8 CF
  sections.push("## 현금흐름·투자·잉여현금");
  sections.push(
    bullets(findings.cash, `${name} 현금흐름 지표가 이번 팩에 없음.`),
  );

  // 9 valuation
  sections.push("## 밸류에이션·배수");
  sections.push(
    bullets(
      [
        `${name} 후행 PER ${fmtN(/** @type {number|null} */ (facts.trailingPE ?? fund?.per))}배 · 선행 PER ${fmtN(/** @type {number|null} */ (facts.forwardPE ?? fund?.forwardPer))}배`,
        facts.pegRatio != null
          ? `PEG ${fmtN(/** @type {number} */ (facts.pegRatio))}배`
          : "",
        `PBR ${fmtN(/** @type {number|null} */ (facts.priceToBook ?? fund?.pbr))}배`,
        facts.priceToSales != null
          ? `PSR ${fmtN(/** @type {number} */ (facts.priceToSales))}배`
          : "",
        facts.enterpriseToRevenue != null
          ? `EV/매출 ${fmtN(/** @type {number} */ (facts.enterpriseToRevenue))}배`
          : "",
        facts.enterpriseToEbitda != null
          ? `EV/EBITDA ${fmtN(/** @type {number} */ (facts.enterpriseToEbitda))}배`
          : "",
        facts.beta != null
          ? `베타 ${fmtN(/** @type {number} */ (facts.beta))}`
          : "",
        facts.fiftyTwoWeekLow != null
          ? `52주 가격대 ${fmtPx(/** @type {number} */ (facts.fiftyTwoWeekLow), ccy)} ~ ${fmtPx(/** @type {number|null} */ (facts.fiftyTwoWeekHigh), ccy)}`
          : "",
        facts.fiftyDayAverage != null
          ? `50일 이평 ${fmtPx(/** @type {number} */ (facts.fiftyDayAverage), ccy)} · 200일 ${fmtPx(/** @type {number|null} */ (facts.twoHundredDayAverage), ccy)}`
          : "",
      ],
      `${name} 밸류에이션 배수가 이번 팩에 없음.`,
    ),
  );

  // 10 shareholder return
  sections.push("## 주주환원·배당·자사주");
  sections.push(
    bullets(
      [
        facts.dividendYield != null || fund?.dividendYield != null
          ? `${name} 배당수익률 ${fmtPct(/** @type {number|null} */ (facts.dividendYield ?? fund?.dividendYield))}`
          : "",
        facts.dividendRate != null
          ? `연간 배당 ${fmtPx(/** @type {number} */ (facts.dividendRate), ccy)}`
          : "",
        facts.payoutRatio != null
          ? `배당성향 ${fmtPct(/** @type {number} */ (facts.payoutRatio))}`
          : "",
        facts.exDividendDate
          ? `배당락일 ${facts.exDividendDate}`
          : "",
      ],
      `${name} 배당·환원 수치가 없거나 무배당.`,
    ),
  );

  // 11 shares
  sections.push("## 시총·유통주식·공매도");
  sections.push(
    bullets(
      [
        `${name} 시총 ${fmtMoney(/** @type {number|null} */ (facts.marketCap ?? fund?.marketCap), ccy)}`,
        facts.sharesOutstanding != null
          ? `발행주식 ${fmtShares(/** @type {number} */ (facts.sharesOutstanding))}`
          : "",
        facts.floatShares != null
          ? `유통주식 ${fmtShares(/** @type {number} */ (facts.floatShares))}`
          : "",
        facts.impliedSharesOutstanding != null
          ? `희석 반영 주식 수 ${fmtShares(/** @type {number} */ (facts.impliedSharesOutstanding))}`
          : "",
        facts.sharesShort != null
          ? `공매도 잔고 ${fmtShares(/** @type {number} */ (facts.sharesShort))} · 공매도비율 ${fmtPct(/** @type {number|null} */ (facts.shortPercentOfFloat))} · 커버일수 ${fmtN(/** @type {number|null} */ (facts.shortRatio))}일`
          : "",
        facts.averageVolume != null
          ? `평균 거래량 ${fmtShares(/** @type {number} */ (facts.averageVolume))} (10일 ${fmtShares(/** @type {number|null} */ (facts.averageVolume10days))})`
          : "",
      ],
      `${name} 유통·공매도 지표가 이번 팩에 없음.`,
    ),
  );

  // 12 insider / institution
  sections.push("## 내부자·기관 지분");
  /** @type {string[]} */
  const own = [];
  if (facts.heldPercentInsiders != null || facts.holdersInsidersPercent != null) {
    own.push(
      `${name} 내부자 보유 ${fmtPct(/** @type {number|null} */ (facts.heldPercentInsiders ?? facts.holdersInsidersPercent))}`,
    );
  }
  if (facts.heldPercentInstitutions != null || facts.holdersInstitutionsPercent != null) {
    own.push(
      `기관 보유 ${fmtPct(/** @type {number|null} */ (facts.heldPercentInstitutions ?? facts.holdersInstitutionsPercent))}`,
    );
  }
  if (facts.holdersInstitutionsCount != null) {
    own.push(`기관 수 ${fmtN(/** @type {number} */ (facts.holdersInstitutionsCount), 0)}곳`);
  }
  const insTx = Array.isArray(facts.insiderTransactions)
    ? facts.insiderTransactions
    : [];
  for (const t of insTx.slice(0, 10)) {
    own.push(
      `내부자거래: ${t.filerName} ${t.transactionText}${t.shares != null ? ` ${fmtShares(t.shares)}` : ""}${t.value != null ? ` (${fmtMoney(t.value, "USD")})` : ""}`,
    );
  }
  const inst = Array.isArray(facts.institutions) ? facts.institutions : [];
  for (const t of inst.slice(0, 8)) {
    own.push(
      `기관: ${t.organization}${t.pctHeld != null ? ` ${fmtPct(t.pctHeld)}` : ""}${t.position != null ? ` · ${fmtShares(t.position)}` : ""}`,
    );
  }
  sections.push(
    bullets(own, `${name} 내부자·기관 지분 데이터가 이번 팩에 없음.`),
  );

  // 13 analysts
  sections.push("## 애널리스트·목표가·컨센");
  /** @type {string[]} */
  const an = [];
  if (facts.targetMeanPrice != null) {
    an.push(
      `${name} 목표가 평균 ${fmtPx(/** @type {number} */ (facts.targetMeanPrice), ccy)} (저 ${fmtPx(/** @type {number|null} */ (facts.targetLowPrice), ccy)} ~ 고 ${fmtPx(/** @type {number|null} */ (facts.targetHighPrice), ccy)}, 중앙 ${fmtPx(/** @type {number|null} */ (facts.targetMedianPrice), ccy)})`,
    );
  }
  if (facts.recommendationKey) {
    an.push(
      `투자의견 ${koRec(facts.recommendationKey)} · 점수 ${fmtN(/** @type {number|null} */ (facts.recommendationMean))} · 참여 ${fmtN(/** @type {number|null} */ (facts.numberOfAnalystOpinions), 0)}명`,
    );
  }
  const trend = Array.isArray(facts.recommendationTrend)
    ? facts.recommendationTrend
    : [];
  for (const t of trend.slice(0, 4)) {
    an.push(
      `투자의견 추이 ${t.period}: 강력매수 ${fmtN(t.strongBuy, 0)} / 매수 ${fmtN(t.buy, 0)} / 보유 ${fmtN(t.hold, 0)} / 매도 ${fmtN(t.sell, 0)} / 강력매도 ${fmtN(t.strongSell, 0)}`,
    );
  }
  const ups = Array.isArray(facts.upgradeDowngradeHistory)
    ? facts.upgradeDowngradeHistory
    : [];
  for (const u of ups.slice(0, 8)) {
    an.push(
      `${u.firm}: ${koAction(u.action)} ${koGrade(u.fromGrade)} → ${koGrade(u.toGrade)}`,
    );
  }
  if (consensus && typeof consensus === "object") {
    const c = /** @type {Record<string, unknown>} */ (consensus);
    if (c.forwardEps != null) {
      an.push(`선행 EPS 컨센 ${fmtPx(Number(c.forwardEps), ccy)}`);
    }
    if (c.trailingEps != null) {
      an.push(`후행 EPS ${fmtPx(Number(c.trailingEps), ccy)}`);
    }
    const periodsMap = c.periods && typeof c.periods === "object" ? c.periods : null;
    const q0 = periodsMap && /** @type {Record<string, { epsAvg?: number|null }>} */ (periodsMap)["0q"];
    if (q0?.epsAvg != null) {
      an.push(`당분기 EPS 컨센 ${fmtPx(Number(q0.epsAvg), ccy)}`);
    }
  }
  sections.push(
    bullets(an, `${name} 애널리스트·컨센 데이터가 이번 팩에 없음.`),
  );

  // 14 calendar
  sections.push("## 최근 실적·가이던스·일정");
  sections.push(
    bullets(
      [
        facts.earningsDate
          ? `${name} 실적 일정: ${facts.earningsDate}`
          : "",
        facts.trailingEps != null || fund?.eps != null
          ? `후행 EPS ${fmtPx(/** @type {number|null} */ (facts.trailingEps ?? fund?.eps), ccy)} · 선행 EPS ${fmtPx(/** @type {number|null} */ (facts.forwardEps ?? fund?.forwardEps), ccy)}`
          : "",
      ],
      `${name} 실적 일정·EPS 힌트가 이번 팩에 없음.`,
    ),
  );

  // 15 filings
  sections.push("## 공시·SEC·이슈");
  sections.push(
    bullets(
      filings.slice(0, 12).map((f) => {
        const when = Number.isFinite(f.filedAt)
          ? new Date(f.filedAt).toISOString().slice(0, 10)
          : "—";
        const formKo = koFilingForm(f.form);
        const title = String(f.title || "").trim();
        const titleKo =
          title && title.toUpperCase() === String(f.form || "").toUpperCase()
            ? formKo
            : title;
        return `${when} ${formKo}${titleKo && titleKo !== formKo ? ` — ${titleKo}` : ""}${f.url ? ` · ${f.url}` : ""}`;
      }),
      meta.market === "us"
        ? `${name} 최근 SEC 공시 목록을 가져오지 못함.`
        : `${name} DART 공시 목록을 이번 생성에서 가져오지 못함.`,
    ),
  );

  // 16 ESG risk — 기업 수치 결론만
  sections.push("## ESG·규제·리스크");
  sections.push(
    bullets(
      findings.risk,
      `${name} ESG·공매도·부채·유동성 등 정량 리스크 지표가 이번 팩에 없음.`,
    ),
  );

  // 17 industry
  sections.push("## 산업·경쟁 포지션");
  sections.push(
    bullets(
      findings.industry,
      `${name} 섹터·마진·성장 포지션 수치가 이번 팩에 없음.`,
    ),
  );

  // 18 outlook
  sections.push("## 미래 전망·시나리오");
  sections.push(
    bullets(
      findings.outlook,
      `${name} 목표가·성장·밸류 기반 전망 수치가 이번 팩에 없음.`,
    ),
  );

  // 19 sources
  sections.push("## 데이터 근거·한계");
  sections.push(
    bullets(
      [
        `스냅샷 ${new Date().toISOString()} · ${name}(${sym})`,
        meta.market === "us"
          ? "출처: 야후 파이낸스 요약 · 재무 기간 아카이브 · 미국 SEC 공시"
          : "출처: 네이버·자체 재무 · 야후(.KS/.KQ) · 전자공시(DART)",
        "수치는 지연·추정·비GAAP가 섞일 수 있음. 투자 권유가 아님.",
      ],
      "",
    ),
  );

  return stripMetaAdviceFromBody(sections.join("\n\n"));
}

/**
 * @param {string} body
 * @param {Record<string, unknown>} facts
 * @param {{ symbol: string; name: string }} meta
 */
async function maybeEnrichWithOpenAI(body, facts, meta) {
  const key = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) return { body, engine: "rules" };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(
          process.env.STOCK_COMPANY_REPORT_LLM_MODEL ??
            process.env.STOCK_ANNOUNCEMENT_LLM_MODEL ??
            "gpt-4o-mini",
        ).trim(),
        temperature: 0.25,
        max_tokens: 5000,
        messages: [
          {
            role: "system",
            content:
              "당신은 한국어만 쓰는 시니어 주식 애널리스트다. ## 제목은 유지하고 본문은 전부 한국어로 쓴다. 영문 사업개요·섹터·투자의견·공시 유형도 한글로 풀어 쓴다. 금액은 반드시 단위를 붙인다(예: 4.46조달러, 305.93달러, 1.2조원). 사실·결론만 쓰고 '확인하세요' 류는 금지. 없는 숫자는 만들지 않는다.",
          },
          {
            role: "user",
            content: `${meta.name}(${meta.symbol}) 보고서 — 전부 한국어·금액 단위 포함.
Facts JSON: ${JSON.stringify(facts).slice(0, 14000)}
초안(한글화·수치 단위 보강, ## 유지):\n${body.slice(0, 12000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return { body, engine: "rules" };
    const data = await res.json();
    const raw = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (raw.length < 800 || !/^##\s/m.test(raw)) return { body, engine: "rules" };
    return {
      body: stripMetaAdviceFromBody(raw.slice(0, 120_000)),
      engine: "rules+openai",
    };
  } catch {
    return { body, engine: "rules" };
  }
}

/**
 * @param {{ symbol: string; name?: string; market?: "kr"|"us" }} args
 */
export async function generateCompanyReport(args) {
  const symbol = String(args.symbol ?? "")
    .trim()
    .toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-^]{1,20}$/.test(symbol)) {
    const err = new Error("올바르지 않은 심볼입니다.");
    err.code = "BAD_SYMBOL";
    throw err;
  }
  if (/-USDT$/i.test(symbol)) {
    const err = new Error("코인 심볼은 기업 보고서를 지원하지 않습니다.");
    err.code = "UNSUPPORTED";
    throw err;
  }

  const market =
    args.market === "kr" || args.market === "us"
      ? args.market
      : isKrQuoteSymbol(symbol)
        ? "kr"
        : "us";
  const name =
    String(args.name ?? "").trim() || resolveDisplayName(symbol) || symbol;

  /** @type {Record<string, unknown>} */
  let facts = {};
  let fund = null;
  let periods = null;
  /** @type {unknown} */
  let consensus = null;
  /** @type {Array<{ form: string; title: string; filedAt: number; url: string }>} */
  let filings = [];
  /** @type {string[]} */
  const sources = [];

  try {
    fund = await loadStockFundamentals(symbol);
    sources.push(fund?.source || "fundamentals");
  } catch {
    fund = null;
  }

  try {
    periods = await loadFinancialPeriods(symbol);
    sources.push("financial-periods");
  } catch {
    periods = null;
  }

  if (market === "us") {
    const pack = await fetchYahooCompanyReportPack(symbol);
    facts = flattenYahooReportFacts(pack);
    if (pack) sources.push("yahoo-quoteSummary");
    try {
      consensus = await fetchYahooConsensusSnapshot(symbol);
      if (consensus) sources.push("yahoo-consensus");
    } catch {
      consensus = null;
    }
    try {
      const edgar = await fetchRecentSecFilingsForSymbol(symbol, {
        limit: 16,
        sinceMs: Date.now() - 400 * 24 * 60 * 60 * 1000,
      });
      filings = (edgar?.filings || []).map((f) => ({
        form: f.form,
        title: f.title,
        filedAt: f.filedAt,
        url: f.url,
      }));
      if (filings.length) sources.push("sec-edgar");
    } catch {
      filings = [];
    }
  } else {
    // KR: fundamentals + Yahoo(.KS/.KQ) + DART
    /** @type {Record<string, unknown>} */
    const fundFacts = {
      currency: fund?.currency || "KRW",
      price: fund?.price ?? null,
      marketCap: fund?.marketCap ?? null,
      trailingPE: fund?.per ?? null,
      forwardPE: fund?.forwardPer ?? null,
      priceToBook: fund?.pbr ?? null,
      trailingEps: fund?.eps ?? null,
      forwardEps: fund?.forwardEps ?? null,
      bookValue: fund?.bps ?? null,
      dividendYield: fund?.dividendYield ?? null,
      profitMargins: fund?.profitMargin ?? null,
      revenueGrowth: fund?.revenueGrowth ?? null,
      returnOnEquity: fund?.roe ?? null,
      longName: name,
    };
    facts = fundFacts;
    sources.push("kr-naver-fundamentals");

    const code = yahooSymbolToKrCode(symbol);
    if (code) {
      for (const ySym of [`${code}.KS`, `${code}.KQ`]) {
        try {
          const pack = await fetchYahooCompanyReportPack(ySym);
          if (!pack) continue;
          const yFacts = flattenYahooReportFacts(pack);
          facts = {
            ...yFacts,
            ...fundFacts,
            longBusinessSummary: yFacts.longBusinessSummary || null,
            longName: yFacts.longName || fundFacts.longName,
            currency: fundFacts.currency || yFacts.currency || "KRW",
            price: fundFacts.price ?? yFacts.price,
            marketCap: fundFacts.marketCap ?? yFacts.marketCap,
            officers: yFacts.officers,
            insiderTransactions: yFacts.insiderTransactions,
            institutions: yFacts.institutions,
            floatShares: yFacts.floatShares ?? null,
            sharesOutstanding: yFacts.sharesOutstanding ?? null,
            heldPercentInsiders: yFacts.heldPercentInsiders ?? null,
            heldPercentInstitutions: yFacts.heldPercentInstitutions ?? null,
          };
          sources.push(`yahoo-quoteSummary:${ySym}`);
          try {
            consensus = await fetchYahooConsensusSnapshot(ySym);
            if (consensus) sources.push("yahoo-consensus");
          } catch {
            /* ignore */
          }
          break;
        } catch {
          /* try next suffix */
        }
      }

      try {
        const dartSym = `${code}.KS`;
        const dartItems = await fetchDartDisclosures(dartSym, 180);
        filings = (Array.isArray(dartItems) ? dartItems : [])
          .slice(0, 16)
          .map((it) => ({
            form: "DART",
            title: String(it?.title ?? "공시"),
            filedAt: Number(it?.publishedAt) || 0,
            url: String(it?.url ?? ""),
          }));
        if (filings.length) sources.push("dart");
      } catch {
        filings = [];
      }
    }
  }

  /** @type {string[]} */
  const periodLines = [];
  /** @type {{ label: string; kind: string; revenue: number|null; opIncome: number|null; netIncome: number|null }[]} */
  const periodMetricRows = [];
  const periodRows = Array.isArray(periods?.periods) ? periods.periods : [];
  const ccyForPeriod = String(
    facts.currency || fund?.currency || (market === "kr" ? "KRW" : "USD"),
  );
  const annualPeriods = periodRows.filter((p) => p.kind === "annual").slice(0, 6);
  const quarterPeriods = periodRows
    .filter((p) => p.kind === "quarter")
    .slice(0, 6);
  const periodsToLoad = [...annualPeriods, ...quarterPeriods];

  for (const p of periodsToLoad) {
    try {
      const detail = await loadFinancialStatementDetail(symbol, p.id);
      const m = extractPeriodMoneyMetrics(detail);
      const label = String(detail.label || p.label || "");
      const kind = p.kind === "annual" ? "annual" : "quarter";
      periodMetricRows.push({
        label,
        kind,
        revenue: m.revenue,
        opIncome: m.opIncome,
        netIncome: m.netIncome,
      });
      /** @type {string[]} */
      const bits = [];
      if (m.revenue != null) bits.push(`매출 ${fmtMoney(m.revenue, ccyForPeriod)}`);
      if (m.opIncome != null) {
        bits.push(`영업이익 ${fmtMoney(m.opIncome, ccyForPeriod)}`);
      }
      if (m.netIncome != null) {
        bits.push(`당기순이익 ${fmtMoney(m.netIncome, ccyForPeriod)}`);
      }
      if (bits.length) {
        periodLines.push(
          `${label} (${kind === "annual" ? "연간" : "분기"}): ${bits.join(" · ")}`,
        );
      }
    } catch {
      /* skip empty periods — 숫자 없는 기간 라벨만 남기지 않음 */
    }
  }

  // 연간 매출 YoY 한 줄 요약
  const annualWithRev = periodMetricRows
    .filter((r) => r.kind === "annual" && r.revenue != null)
    .slice()
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  if (annualWithRev.length >= 2) {
    const prev = annualWithRev[annualWithRev.length - 2];
    const last = annualWithRev[annualWithRev.length - 1];
    if (prev.revenue && last.revenue) {
      const yoy = ((last.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
      periodLines.unshift(
        `${last.label} 연간 매출 ${fmtMoney(last.revenue, ccyForPeriod)} · 전년(${prev.label}) 대비 ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`,
      );
    }
  }

  const displayName =
    String(facts.longName || facts.shortName || name).trim() || name;

  if (facts.longBusinessSummary) {
    facts.longBusinessSummary = await translatePassageToKorean(
      String(facts.longBusinessSummary),
    );
  }

  const charts = buildReportCharts(
    periodMetricRows,
    facts,
    ccyForPeriod,
    displayName,
  );

  let body = buildRulesBody(
    facts,
    fund,
    periods,
    consensus,
    filings,
    {
      symbol,
      name: displayName,
      market,
    },
    periodLines,
  );
  const enriched = await maybeEnrichWithOpenAI(body, facts, {
    symbol,
    name: displayName,
  });
  body = stripMetaAdviceFromBody(enriched.body);

  const summaryBits = [
    displayName,
    symbol,
    facts.sector ? koIndustryLabel(facts.sector) : "",
    facts.industry ? koIndustryLabel(facts.industry) : "",
    facts.marketCap != null
      ? `시총 ${fmtMoney(/** @type {number} */ (facts.marketCap), String(facts.currency || "USD"))}`
      : "",
  ].filter(Boolean);

  const row = upsertCompanyReport({
    symbol,
    name: displayName,
    market,
    title: `${displayName} (${symbol}) 기업 심층 보고서`,
    summary: summaryBits.join(" · ").slice(0, 400),
    body,
    toc: [...COMPANY_REPORT_TOC],
    sources: [...new Set(sources)],
    status: "ready",
    error: null,
    engine: `${enriched.engine}|v${COMPANY_REPORT_VERSION}`,
    charts,
  });

  return row;
}
