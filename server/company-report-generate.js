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
import { upsertCompanyReport } from "./company-report-store.js";

export const COMPANY_REPORT_VERSION = 2;

export const COMPANY_REPORT_TOC = [
  "한줄 요약·투자 포인트",
  "회사 개요·성장 스토리",
  "사업·제품·세그먼트",
  "경영진·조직",
  "매출·성장 추이",
  "수익성·마진·ROE",
  "재무상태·건전성",
  "현금흐름·CapEx·FCF",
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
  return n.toLocaleString("en-US", {
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

/** @param {number | null | undefined} n @param {string} [ccy] */
function fmtMoney(n, ccy = "USD") {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (ccy === "KRW") {
    if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}조원`;
    if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}억원`;
    return `${Math.round(n).toLocaleString("ko-KR")}원`;
  }
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${fmtN(n)}`;
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
        `${name} 영업CF ${fmtMoney(ocf, ccy)} · FCF ${fmtMoney(fcf, ccy)} · FCF/영업CF ${conv.toFixed(0)}%`,
      );
      if (drain > 0) {
        cash.push(
          `영업CF 대비 FCF 차감분(투자·CapEx성) 약 ${fmtMoney(drain, ccy)}`,
        );
      } else if (drain < 0) {
        cash.push(
          `FCF가 영업CF를 상회 — 운전자본·일회성 유입 영향 가능 (${fmtMoney(Math.abs(drain), ccy)})`,
        );
      }
    }
  } else {
    if (facts.operatingCashflow != null) {
      cash.push(`영업CF ${fmtMoney(/** @type {number} */ (facts.operatingCashflow), ccy)}`);
    }
    if (facts.freeCashflow != null) {
      cash.push(`FCF ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)}`);
    }
  }

  if (facts.esgTotal != null) {
    risk.push(
      `${name} ESG Total ${fmtN(/** @type {number} */ (facts.esgTotal))} (E ${fmtN(/** @type {number|null} */ (facts.esgEnvironment))} / S ${fmtN(/** @type {number|null} */ (facts.esgSocial))} / G ${fmtN(/** @type {number|null} */ (facts.esgGovernance))})`,
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
      `${name} 소속: ${[facts.sector, facts.industry].filter(Boolean).join(" > ")}`,
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
      `${name} 현재가 대비 컨센 목표가 평균 괴리 ${upside >= 0 ? "+" : ""}${upside.toFixed(1)}% (목표가 ${fmtN(/** @type {number} */ (facts.targetMeanPrice))})`,
    );
  }
  if (facts.recommendationKey) {
    outlook.push(
      `애널리스트 컨센 투자의견 ${facts.recommendationKey}${
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
      `밸류: Trailing PER ${fmtN(/** @type {number|null} */ (facts.trailingPE))} · Forward PER ${fmtN(/** @type {number|null} */ (facts.forwardPE))}`,
    );
  }
  if (facts.freeCashflow != null && Number(facts.freeCashflow) > 0) {
    outlook.push(`${name} FCF 흑자 ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)} — 환원·재투자 여력 존재`);
  } else if (facts.freeCashflow != null && Number(facts.freeCashflow) < 0) {
    outlook.push(`${name} FCF 적자 ${fmtMoney(/** @type {number} */ (facts.freeCashflow), ccy)} — 현금 창출보다 투자/유출이 큼`);
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
    `${name}(${sym}) · ${facts.sector || "—"} / ${facts.industry || "—"} · ${facts.exchange || meta.market.toUpperCase()}`,
  );
  if (facts.price != null) {
    headline.push(
      `현재가 ${fmtMoney(/** @type {number} */ (facts.price), ccy === "KRW" ? "KRW" : "USD").replace(/^\$/, ccy === "KRW" ? "" : "$")} · 시총 ${fmtMoney(/** @type {number|null} */ (facts.marketCap ?? fund?.marketCap), ccy)}`,
    );
  } else if (fund?.price != null) {
    headline.push(
      `참고가 ${fmtN(fund.price)} · 시총 ${fmtMoney(fund.marketCap, ccy)}`,
    );
  }
  if (facts.trailingPE != null || fund?.per != null) {
    headline.push(
      `Trailing PER ${fmtN(/** @type {number|null} */ (facts.trailingPE ?? fund?.per))} · Forward PER ${fmtN(/** @type {number|null} */ (facts.forwardPE ?? fund?.forwardPer))}`,
    );
  }
  if (facts.revenueGrowth != null || fund?.revenueGrowth != null) {
    headline.push(
      `매출 성장 ${fmtPct(/** @type {number|null} */ (facts.revenueGrowth ?? fund?.revenueGrowth))}`,
    );
  }
  if (facts.recommendationKey) {
    headline.push(
      `컨센 투자의견 ${facts.recommendationKey} (평균 ${fmtN(/** @type {number|null} */ (facts.recommendationMean))}, 애널 ${fmtN(/** @type {number|null} */ (facts.numberOfAnalystOpinions), 0)}명)`,
    );
  }
  sections.push(bullets(headline, "핵심 지표를 충분히 모으지 못했습니다."));

  // 2 profile
  sections.push("## 회사 개요·성장 스토리");
  /** @type {string[]} */
  const story = [];
  if (facts.longBusinessSummary) {
    story.push(String(facts.longBusinessSummary).slice(0, 2200));
  }
  story.push(
    `본사 ${[facts.city, facts.country].filter(Boolean).join(", ") || "—"} · 임직원 ${fmtN(/** @type {number|null} */ (facts.fullTimeEmployees), 0)}명 · 웹사이트 ${facts.website || "—"}`,
  );
  if (facts.longName && facts.longName !== name) {
    story.push(`공식명: ${facts.longName}`);
  }
  sections.push(
    bullets(
      story,
      meta.market === "kr"
        ? `${name} 사업 개요 원문(longBusinessSummary)이 이번 팩에 없음.`
        : `${name} 사업 개요 원문을 확보하지 못함.`,
    ),
  );

  // 3 business
  sections.push("## 사업·제품·세그먼트");
  sections.push(
    bullets(
      [
        facts.sector ? `${name} 섹터: ${facts.sector}` : "",
        facts.industry ? `${name} 산업: ${facts.industry}` : "",
        facts.totalRevenue != null
          ? `${name} TTM 매출 ${fmtMoney(/** @type {number} */ (facts.totalRevenue), ccy)} · 주당 매출 ${fmtN(/** @type {number|null} */ (facts.revenuePerShare))}`
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
      officers.map(
        (o) =>
          `${o.name}${o.title ? ` — ${o.title}` : ""}${o.age != null ? ` (age ${o.age})` : ""}${o.totalPay != null ? ` · 보수 ${fmtMoney(o.totalPay, "USD")}` : ""}`,
      ),
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
  sections.push("## 현금흐름·CapEx·FCF");
  sections.push(
    bullets(findings.cash, `${name} 현금흐름 지표가 이번 팩에 없음.`),
  );

  // 9 valuation
  sections.push("## 밸류에이션·배수");
  sections.push(
    bullets(
      [
        `${name} PER ${fmtN(/** @type {number|null} */ (facts.trailingPE ?? fund?.per))} / Forward PER ${fmtN(/** @type {number|null} */ (facts.forwardPE ?? fund?.forwardPer))}`,
        facts.pegRatio != null
          ? `PEG ${fmtN(/** @type {number} */ (facts.pegRatio))}`
          : "",
        `PBR ${fmtN(/** @type {number|null} */ (facts.priceToBook ?? fund?.pbr))}`,
        facts.priceToSales != null
          ? `PSR ${fmtN(/** @type {number} */ (facts.priceToSales))}`
          : "",
        facts.enterpriseToRevenue != null
          ? `EV/Sales ${fmtN(/** @type {number} */ (facts.enterpriseToRevenue))}`
          : "",
        facts.enterpriseToEbitda != null
          ? `EV/EBITDA ${fmtN(/** @type {number} */ (facts.enterpriseToEbitda))}`
          : "",
        facts.beta != null
          ? `베타 ${fmtN(/** @type {number} */ (facts.beta))}`
          : "",
        facts.fiftyTwoWeekLow != null
          ? `52주 ${fmtN(/** @type {number} */ (facts.fiftyTwoWeekLow))} ~ ${fmtN(/** @type {number|null} */ (facts.fiftyTwoWeekHigh))}`
          : "",
        facts.fiftyDayAverage != null
          ? `50일 이평 ${fmtN(/** @type {number} */ (facts.fiftyDayAverage))} · 200일 ${fmtN(/** @type {number|null} */ (facts.twoHundredDayAverage))}`
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
          ? `연간 배당 ${fmtN(/** @type {number} */ (facts.dividendRate))}`
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
          ? `발행주식 ${fmtN(/** @type {number} */ (facts.sharesOutstanding), 0)}`
          : "",
        facts.floatShares != null
          ? `유통주식(float) ${fmtN(/** @type {number} */ (facts.floatShares), 0)}`
          : "",
        facts.impliedSharesOutstanding != null
          ? `희석 반영 주식 수 ${fmtN(/** @type {number} */ (facts.impliedSharesOutstanding), 0)}`
          : "",
        facts.sharesShort != null
          ? `공매도 잔고 ${fmtN(/** @type {number} */ (facts.sharesShort), 0)} · 공매도비율 ${fmtPct(/** @type {number|null} */ (facts.shortPercentOfFloat))} · days to cover ${fmtN(/** @type {number|null} */ (facts.shortRatio))}`
          : "",
        facts.averageVolume != null
          ? `평균 거래량 ${fmtN(/** @type {number} */ (facts.averageVolume), 0)} (10일 ${fmtN(/** @type {number|null} */ (facts.averageVolume10days), 0)})`
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
    own.push(`기관 수 ${fmtN(/** @type {number} */ (facts.holdersInstitutionsCount), 0)}`);
  }
  const insTx = Array.isArray(facts.insiderTransactions)
    ? facts.insiderTransactions
    : [];
  for (const t of insTx.slice(0, 10)) {
    own.push(
      `내부자거래: ${t.filerName} ${t.transactionText}${t.shares != null ? ` ${fmtN(t.shares, 0)}주` : ""}${t.value != null ? ` (${fmtMoney(t.value, "USD")})` : ""}`,
    );
  }
  const inst = Array.isArray(facts.institutions) ? facts.institutions : [];
  for (const t of inst.slice(0, 8)) {
    own.push(
      `기관: ${t.organization}${t.pctHeld != null ? ` ${fmtPct(t.pctHeld)}` : ""}${t.position != null ? ` · ${fmtN(t.position, 0)}주` : ""}`,
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
      `${name} 목표가 평균 ${fmtN(/** @type {number} */ (facts.targetMeanPrice))} (저 ${fmtN(/** @type {number|null} */ (facts.targetLowPrice))} ~ 고 ${fmtN(/** @type {number|null} */ (facts.targetHighPrice))}, 중앙 ${fmtN(/** @type {number|null} */ (facts.targetMedianPrice))})`,
    );
  }
  if (facts.recommendationKey) {
    an.push(
      `투자의견 ${facts.recommendationKey} · 점수 ${fmtN(/** @type {number|null} */ (facts.recommendationMean))} · 참여 ${fmtN(/** @type {number|null} */ (facts.numberOfAnalystOpinions), 0)}명`,
    );
  }
  const trend = Array.isArray(facts.recommendationTrend)
    ? facts.recommendationTrend
    : [];
  for (const t of trend.slice(0, 4)) {
    an.push(
      `투자의견 추이 ${t.period}: StrongBuy ${fmtN(t.strongBuy, 0)} / Buy ${fmtN(t.buy, 0)} / Hold ${fmtN(t.hold, 0)} / Sell ${fmtN(t.sell, 0)} / StrongSell ${fmtN(t.strongSell, 0)}`,
    );
  }
  const ups = Array.isArray(facts.upgradeDowngradeHistory)
    ? facts.upgradeDowngradeHistory
    : [];
  for (const u of ups.slice(0, 8)) {
    an.push(
      `${u.firm}: ${u.action || "change"} ${u.fromGrade || "—"} → ${u.toGrade || "—"}`,
    );
  }
  if (consensus && typeof consensus === "object") {
    const c = /** @type {Record<string, unknown>} */ (consensus);
    if (c.forwardEps != null) an.push(`전방 EPS 컨센 ${fmtN(Number(c.forwardEps))}`);
    if (c.trailingEps != null) an.push(`트레일링 EPS ${fmtN(Number(c.trailingEps))}`);
    const periodsMap = c.periods && typeof c.periods === "object" ? c.periods : null;
    const q0 = periodsMap && /** @type {Record<string, { epsAvg?: number|null }>} */ (periodsMap)["0q"];
    if (q0?.epsAvg != null) an.push(`당분기 EPS 컨센 ${fmtN(Number(q0.epsAvg))}`);
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
          ? `Trailing EPS ${fmtN(/** @type {number|null} */ (facts.trailingEps ?? fund?.eps))} · Forward EPS ${fmtN(/** @type {number|null} */ (facts.forwardEps ?? fund?.forwardEps))}`
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
        return `${when} ${f.form} — ${f.title}${f.url ? ` · ${f.url}` : ""}`;
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
          ? "출처: Yahoo quoteSummary · 재무 기간 아카이브 · SEC EDGAR"
          : "출처: 네이버/자체 재무 · Yahoo(.KS/.KQ) · DART",
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
              "You are a senior equity analyst writing ONLY about THIS company in Korean. Keep every ## heading. Fill sections with concrete facts and YOUR conclusions from the JSON numbers (margins, growth, leverage, short interest, targets). State findings about the firm — never tell the reader what to check, how to interpret generally, or industry caveats. Forbidden phrases: 확인하세요, 대조하세요, 가중치가 다릅니다, 봐야 합니다, 교차하세요, 가늠, 가정해 해석, 업종별로. Never invent numbers absent from facts.",
          },
          {
            role: "user",
            content: `Write findings about ${meta.name} (${meta.symbol}) only.
Facts JSON: ${JSON.stringify(facts).slice(0, 14000)}
Draft (improve into company-specific analysis, keep ## headings):\n${body.slice(0, 12000)}`,
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
  const periodRows = Array.isArray(periods?.periods) ? periods.periods : [];
  const ccyForPeriod =
    String(facts.currency || fund?.currency || (market === "kr" ? "KRW" : "USD"));
  for (const p of periodRows.slice(0, 5)) {
    try {
      const detail = await loadFinancialStatementDetail(symbol, p.id);
      const secs = Array.isArray(detail?.sections) ? detail.sections : [];
      /** @type {string[]} */
      const bits = [];
      for (const sec of secs) {
        const rows = Array.isArray(sec?.rows) ? sec.rows : [];
        for (const row of rows) {
          const label = String(row?.label ?? row?.name ?? "");
          const val = row?.value ?? row?.raw ?? null;
          if (val == null || !Number.isFinite(Number(val))) continue;
          if (
            /total revenue|^revenue$|총매출|매출액|영업수익/i.test(label) &&
            !/cost|비용|매출원가/i.test(label)
          ) {
            bits.push(`매출 ${fmtMoney(Number(val), ccyForPeriod)}`);
          } else if (/operating income|영업이익/i.test(label)) {
            bits.push(`영업이익 ${fmtMoney(Number(val), ccyForPeriod)}`);
          } else if (
            /net income|당기순이익/i.test(label) &&
            !/comprehensive/i.test(label)
          ) {
            bits.push(`순이익 ${fmtMoney(Number(val), ccyForPeriod)}`);
          }
        }
      }
      if (bits.length) {
        periodLines.push(
          `${detail.label || p.label} (${p.kind === "annual" ? "연간" : "분기"}): ${[...new Set(bits)].slice(0, 4).join(" · ")}`,
        );
      } else {
        periodLines.push(
          `기간 ${p.label} (${p.kind === "annual" ? "연간" : "분기"}, 출처 ${p.source || "—"})`,
        );
      }
    } catch {
      periodLines.push(
        `기간 ${p.label} (${p.kind === "annual" ? "연간" : "분기"})`,
      );
    }
  }

  const displayName =
    String(facts.longName || facts.shortName || name).trim() || name;
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
    facts.sector ? String(facts.sector) : "",
    facts.industry ? String(facts.industry) : "",
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
  });

  return row;
}
