#!/usr/bin/env node
/**
 * 버핏식 내재가치 백테스팅 v2
 * ─ 서버 loadBuffettIntrinsicValue 활용 → historicalEps 추출
 * ─ 가용 EPS 연도 범위에서 연도별 시뮬레이션
 * ─ 야후 월봉 수정주가로 연말 가격 계산 → 1년 실제 수익률
 * ─ 결과를 HTML 이메일로 발송
 *
 * node scripts/backtest-buffett-intrinsic.mjs [--dry-run]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const rootUrl = (rel) => pathToFileURL(join(ROOT, rel)).href;

// ─── 모듈 로드 ───────────────────────────────────────────────────────────────
const { loadEnvFile } = await import(rootUrl("server/load-env.js"));
loadEnvFile();

const { sendTransactionalEmail, isEmailSendingConfigured } = await import(
  rootUrl("server/email-sender.js"),
);
const { getYahooSession } = await import(rootUrl("server/yahoo.js"));
const { loadBuffettIntrinsicValue } = await import(
  rootUrl("server/buffett-intrinsic-input.js"),
);
const { calcFullIntrinsic, calcSimpleFairPrice, calcMarginOfSafetyPrice } =
  await import(rootUrl("server/buffett-intrinsic-value.js"));

// ─── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TO = "samron3797@gmail.com";

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// ─── 역사적 무위험 수익률 (연말 10년 국채) ─────────────────────────────────
const HIST_RATE_US = {
  2018: 0.0269, 2019: 0.0192, 2020: 0.0093,
  2021: 0.0151, 2022: 0.0388, 2023: 0.0397, 2024: 0.0457,
};
const HIST_RATE_KR = {
  2018: 0.0200, 2019: 0.0167, 2020: 0.0172,
  2021: 0.0226, 2022: 0.0373, 2023: 0.0320, 2024: 0.0274,
};

// ─── 기준 지수 수익률 (연말→연말) ──────────────────────────────────────────
const BENCH_SP500  = { 2019:0.288, 2020:0.163, 2021:0.269, 2022:-0.195, 2023:0.243, 2024:0.232 };
const BENCH_KOSPI  = { 2019:0.076, 2020:0.308, 2021:0.037, 2022:-0.244, 2023:0.192, 2024:-0.098 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt2  = (n) => Number.isFinite(n) ? n.toFixed(2) : "—";
const fmtPct = (n) => Number.isFinite(n) ? `${(n*100).toFixed(1)}%` : "—";
const fmtSign = (n) => Number.isFinite(n) ? `${n>=0?"+":""}${(n*100).toFixed(1)}%` : "—";

// ─── Yahoo 세션 래퍼 ─────────────────────────────────────────────────────────
let _session = null;
async function yahooFetch(path) {
  if (!_session || Date.now() > (_session.expires ?? 0)) {
    _session = await getYahooSession();
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://query2.finance.yahoo.com${path}${sep}crumb=${encodeURIComponent(_session.crumb)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": YAHOO_UA, Cookie: _session.cookie },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (res.status === 429 || /too many requests/i.test(text)) {
        console.warn(`  [rate-limit] 대기 30s`);
        await sleep(30_000);
        _session = await getYahooSession();
        continue;
      }
      if (!res.ok) return null;
      return JSON.parse(text);
    } catch { return null; }
  }
  return null;
}

// ─── 연말 종가 조회 (Yahoo v8 월봉) ─────────────────────────────────────────
async function fetchYearEndPrices(symbol) {
  const data = await yahooFetch(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?range=8y&interval=1mo`,
  );
  const result = data?.chart?.result?.[0];
  if (!result) return new Map();

  const ts = result.timestamps ?? result.timestamp ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? close;

  const byYM = new Map();
  for (let i = 0; i < ts.length; i++) {
    const d = new Date(ts[i] * 1000);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const p = Number(adjClose[i] ?? close[i]);
    if (!Number.isFinite(p) || p <= 0) continue;
    byYM.set(`${y}-${String(m).padStart(2,"0")}`, p);
  }

  const priceMap = new Map();
  for (let year = 2017; year <= 2026; year++) {
    for (const m of [12, 11, 10, 9]) {
      const key = `${year}-${String(m).padStart(2,"0")}`;
      if (byYM.has(key)) { priceMap.set(year, byYM.get(key)); break; }
    }
  }
  return priceMap;
}

// ─── 버핏 신호 계산 ──────────────────────────────────────────────────────────
function computeSignal(eps0, epsSeries, discountRate) {
  if (!eps0 || eps0 <= 0 || !discountRate || discountRate <= 0) return null;
  const pos = epsSeries.filter(s => s.eps > 0);
  if (pos.length < 2) return null;

  const first = pos[0], last = pos[pos.length - 1];
  const span = last.year - first.year;
  if (span < 1) return null;

  const cagr = (last.eps / first.eps) ** (1 / span) - 1;
  if (!Number.isFinite(cagr) || cagr < -0.5 || cagr > 3.0) return null;

  const growthTerminal = Math.min(Math.max(cagr * 0.33, 0), 0.05);
  const full = calcFullIntrinsic({
    eps0, growth10y: cagr, growthTerminal, years: 10,
    discountRate, debtPerShare: null,
  });
  const simple = calcSimpleFairPrice(eps0, discountRate);
  const intrinsic = full?.intrinsicPerShare ?? simple;
  if (!intrinsic || intrinsic <= 0) return null;

  const mos = calcMarginOfSafetyPrice(intrinsic, 0.25);
  return { intrinsic, mos, cagr, simple: simple ?? null };
}

// ─── 종목별 백테스팅 ──────────────────────────────────────────────────────────
async function backtestStock(stock, market) {
  const { symbol, name } = stock;

  // 서버 모듈로 historicalEps 획득
  let intrinsicData;
  try {
    intrinsicData = await loadBuffettIntrinsicValue(symbol);
  } catch { return []; }

  const epsFull = (intrinsicData?.historicalEps ?? []).filter(e => e.eps > 0);
  if (epsFull.length < 2) return [];

  // 현재 판정도 포함
  const currentEps0   = intrinsicData?.inputs?.eps0;
  const currentIntr   = intrinsicData?.outputs?.intrinsicPerShare;
  const currentVerdict = intrinsicData?.outputs?.verdict;

  // 연말 가격 조회
  const priceMap = await fetchYearEndPrices(symbol);
  await sleep(800);
  if (priceMap.size === 0) return [];

  const histRates = market === "us" ? HIST_RATE_US : HIST_RATE_KR;

  const results = [];

  // EPS 시리즈의 연도 범위로 시뮬레이션 가능 연도 결정
  const epsYears = epsFull.map(e => e.year);
  const firstEpsYear = Math.min(...epsYears);
  const lastEpsYear  = Math.max(...epsYears);

  // simYear: EPS 2개 이상 있는 해부터, 최신 연도까지 (진입가와 내년가 모두 있어야)
  for (let simYear = firstEpsYear + 1; simYear <= lastEpsYear; simYear++) {
    const entryPrice = priceMap.get(simYear);
    const exitPrice  = priceMap.get(simYear + 1) ?? priceMap.get(simYear + 1)
      ?? (simYear === 2025 ? priceMap.get(2026) ?? priceMap.get(2025) : null);
    if (!entryPrice) continue;

    // 올해(2025)는 일부 데이터만 → 2025-12월 없으면 2026 최신가로 대체
    let resolvedExitPrice = exitPrice;
    if (!resolvedExitPrice && simYear === 2024) {
      // 2026 상반기 최신 데이터 사용
      resolvedExitPrice = priceMap.get(2026) ?? priceMap.get(2025);
    }
    if (!resolvedExitPrice) continue;

    const availableEps = epsFull.filter(e => e.year <= simYear);
    if (availableEps.length < 2) continue;

    const eps0 = availableEps[availableEps.length - 1].eps;
    const dr = histRates[simYear];
    if (!dr) continue;

    const sig = computeSignal(eps0, availableEps, dr);
    if (!sig) continue;

    const { intrinsic, mos, cagr } = sig;
    const gap = (intrinsic - entryPrice) / entryPrice;

    let verdict;
    if (mos != null && entryPrice <= mos) verdict = "below_margin";
    else if (entryPrice < intrinsic)       verdict = "below_intrinsic";
    else if (gap < -0.15)                  verdict = "rich";
    else                                   verdict = "near_fair";

    const ret1y = resolvedExitPrice / entryPrice - 1;
    const isFwdPartial = simYear >= 2025;  // 아직 완료 안된 연도

    results.push({
      symbol, name, market, simYear,
      eps0, discountRate: dr, growth10y: cagr,
      intrinsic, mosPrice: mos,
      entryPrice, exitPrice: resolvedExitPrice,
      gap, verdict, ret1y, isFwdPartial,
    });
  }

  return results;
}

// ─── 유니버스 로드 ────────────────────────────────────────────────────────────
function loadSampleUniverse() {
  const krAll = JSON.parse(readFileSync(join(ROOT,"server/data/universe-kr.json"),"utf8"));
  const usAll = JSON.parse(readFileSync(join(ROOT,"server/data/universe-us.json"),"utf8"));

  const usPriority = [
    "AAPL","MSFT","AMZN","GOOGL","META","NVDA","BRK-B","JNJ","JPM","V",
    "PG","UNH","HD","MA","XOM","LLY","ABBV","CVX","MRK","PEP",
    "KO","AVGO","COST","MCD","WMT","DIS","BAC","NFLX","ADBE","TMO",
    "ACN","NKE","PM","T","IBM","GE","GS","MS","CAT","SBUX",
  ];
  const usMap = new Map(usAll.map(s => [s.symbol, s]));
  const us = usPriority.map(sym => usMap.get(sym) ?? { symbol: sym, name: sym });

  return {
    kr: krAll.slice(0, 45),  // KR 시총 상위 45
    us: us.slice(0, 40),     // US 우선 40
  };
}

// ─── 통계 ─────────────────────────────────────────────────────────────────────
function stats(trades) {
  if (!trades?.length) return null;
  const rets = trades.map(t => t.ret1y);
  const avg  = rets.reduce((a,b)=>a+b,0)/rets.length;
  const wins = rets.filter(r=>r>0).length;
  const winRate = wins/rets.length;
  const variance = rets.reduce((acc,r)=>acc+(r-avg)**2,0)/rets.length;
  const std = Math.sqrt(variance);
  const sharpe = std > 0 ? avg/std : null;
  return {
    count: trades.length, avg, winRate, std, sharpe,
    maxRet: Math.max(...rets), minRet: Math.min(...rets),
    medRet: [...rets].sort((a,b)=>a-b)[Math.floor(rets.length/2)],
  };
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
console.log("=== 버핏식 내재가치 백테스팅 v2 ===");
await getYahooSession();

const { kr: krSample, us: usSample } = loadSampleUniverse();
console.log(`샘플: KR ${krSample.length}개 + US ${usSample.length}개`);

const allResults = [];

console.log("\n[1/2] KR 종목...");
for (let i = 0; i < krSample.length; i++) {
  const s = krSample[i];
  process.stdout.write(`  (${i+1}/${krSample.length}) ${s.symbol}... `);
  try {
    const res = await backtestStock(s, "kr");
    allResults.push(...res);
    process.stdout.write(`${res.length}건\n`);
  } catch(e) { process.stdout.write(`오류: ${e.message}\n`); }
  await sleep(600);
}

console.log("\n[2/2] US 종목...");
for (let i = 0; i < usSample.length; i++) {
  const s = usSample[i];
  process.stdout.write(`  (${i+1}/${usSample.length}) ${s.symbol}... `);
  try {
    const res = await backtestStock(s, "us");
    allResults.push(...res);
    process.stdout.write(`${res.length}건\n`);
  } catch(e) { process.stdout.write(`오류: ${e.message}\n`); }
  await sleep(900);
}

console.log(`\n총 시뮬레이션: ${allResults.length}건`);
if (!allResults.length) { console.error("결과 없음"); process.exit(1); }

// ─── 집계 ─────────────────────────────────────────────────────────────────────
const completed = allResults.filter(r => !r.isFwdPartial);  // 1년 완료 데이터만
const partial   = allResults.filter(r => r.isFwdPartial);

const byV = {
  below_margin:    completed.filter(r=>r.verdict==="below_margin"),
  below_intrinsic: completed.filter(r=>r.verdict==="below_intrinsic"),
  near_fair:       completed.filter(r=>r.verdict==="near_fair"),
  rich:            completed.filter(r=>r.verdict==="rich"),
};
const buyAll  = [...byV.below_margin, ...byV.below_intrinsic];
const noTrade = [...byV.near_fair,    ...byV.rich];

const stAll  = stats(completed);
const stBuy  = stats(buyAll);
const stNo   = stats(noTrade);
const stKr   = stats(completed.filter(r=>r.market==="kr"));
const stUs   = stats(completed.filter(r=>r.market==="us"));
const stMos  = stats(byV.below_margin);
const stBlow = stats(byV.below_intrinsic);
const stFair = stats(byV.near_fair);
const stRich = stats(byV.rich);

// 연도별 분석
const simYearsFound = [...new Set(completed.map(r=>r.simYear))].sort();
const byYear = simYearsFound.map(y => {
  const yr  = completed.filter(r=>r.simYear===y);
  const buy = yr.filter(r=>r.verdict==="below_margin"||r.verdict==="below_intrinsic");
  const mosOnly = yr.filter(r=>r.verdict==="below_margin");
  const ySt  = stats(yr);
  const bSt  = stats(buy);
  const mSt  = stats(mosOnly);
  const mkt  = yr[0]?.market === "kr" ? "kr" : "mixed";
  return { year:y, ySt, bSt, mSt, buyCount:buy.length, allCount:yr.length, mkt };
});

// 상위/하위 종목 (MOS 신호 중)
const topTrades = [...buyAll].sort((a,b)=>b.ret1y-a.ret1y).slice(0,15);
const botTrades = [...buyAll].sort((a,b)=>a.ret1y-b.ret1y).slice(0,15);

// ─── HTML 보고서 ──────────────────────────────────────────────────────────────
const now = new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"});

function sRow(label, s, hi=false) {
  if (!s) return `<tr><td><b>${label}</b></td><td colspan="7" style="color:#aaa">데이터 없음</td></tr>`;
  const bg = hi ? "background:#fffbe6;" : "";
  return `<tr style="${bg}">
    <td><b>${label}</b></td>
    <td style="text-align:center">${s.count}</td>
    <td style="color:${s.avg>=0?"#1a7a4a":"#c0392b"}">${fmtSign(s.avg)}</td>
    <td style="color:${s.winRate>=0.5?"#1a7a4a":"#c0392b"}">${fmtPct(s.winRate)}</td>
    <td>${fmt2(s.sharpe??NaN)}</td>
    <td>${fmtSign(s.medRet)}</td>
    <td style="color:#1a7a4a">${fmtSign(s.maxRet)}</td>
    <td style="color:#c0392b">${fmtSign(s.minRet)}</td>
  </tr>`;
}

function verdictBadge(v) {
  return {below_margin:"🟢 MOS매수", below_intrinsic:"🔵 내재가치이하", near_fair:"🟡 적정", rich:"🔴 고평가"}[v] ?? v;
}

function tRow(t) {
  return `<tr>
    <td style="text-align:center">${t.simYear}</td>
    <td><b>${t.symbol}</b></td>
    <td>${(t.name??"").slice(0,10)}</td>
    <td style="text-align:center">${t.market.toUpperCase()}</td>
    <td style="text-align:center">${verdictBadge(t.verdict)}</td>
    <td>${fmt2(t.eps0)}</td>
    <td>${fmtPct(t.growth10y)}</td>
    <td>${fmt2(t.intrinsic)}</td>
    <td>${fmt2(t.entryPrice)}</td>
    <td style="color:${t.ret1y>=0?"#1a7a4a":"#c0392b"}">${fmtSign(t.ret1y)}</td>
  </tr>`;
}

// 연도별 비교 행
function yrRow(d) {
  const buy = fmtSign(d.bSt?.avg);
  const all = fmtSign(d.ySt?.avg);
  const sp  = Number.isFinite(BENCH_SP500[d.year]) ? fmtSign(BENCH_SP500[d.year]) : "—";
  const ko  = Number.isFinite(BENCH_KOSPI[d.year]) ? fmtSign(BENCH_KOSPI[d.year]) : "—";
  const alphaVsSp = d.bSt?.avg != null && BENCH_SP500[d.year] != null
    ? fmtSign(d.bSt.avg - BENCH_SP500[d.year]) : "—";
  const alphaVsKo = d.bSt?.avg != null && BENCH_KOSPI[d.year] != null
    ? fmtSign(d.bSt.avg - BENCH_KOSPI[d.year]) : "—";
  return `<tr>
    <td style="text-align:center"><b>${d.year}</b></td>
    <td style="text-align:center">${d.buyCount}/${d.allCount}</td>
    <td style="color:${(d.bSt?.avg??0)>=0?"#1a7a4a":"#c0392b"}">${buy}</td>
    <td style="color:${(d.ySt?.avg??0)>=0?"#1a7a4a":"#c0392b"}">${all}</td>
    <td style="color:${(BENCH_SP500[d.year]??0)>=0?"#1a7a4a":"#c0392b"}">${sp}</td>
    <td style="color:${(BENCH_KOSPI[d.year]??0)>=0?"#1a7a4a":"#c0392b"}">${ko}</td>
    <td style="color:${parseFloat(alphaVsSp)>=0?"#1a7a4a":"#c0392b"}">${alphaVsSp}</td>
    <td style="color:${parseFloat(alphaVsKo)>=0?"#1a7a4a":"#c0392b"}">${alphaVsKo}</td>
  </tr>`;
}

// 전체 상세 목록
const fullDetail = [...completed].sort((a,b)=>a.simYear-b.simYear||a.market.localeCompare(b.market));

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>
body{font-family:'Malgun Gothic',sans-serif;font-size:13px;color:#222;max-width:1000px;margin:0 auto;padding:20px}
h1{color:#2c3e50;font-size:21px;border-bottom:3px solid #2c3e50;padding-bottom:8px}
h2{color:#34495e;font-size:15px;margin-top:28px;border-left:4px solid #3498db;padding-left:8px}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
th{background:#2c3e50;color:#fff;padding:6px 10px;text-align:center}
td{border:1px solid #ddd;padding:5px 9px;text-align:right;white-space:nowrap}
td:first-child,td:nth-child(2),td:nth-child(3){text-align:left}
tr:nth-child(even){background:#f9f9f9}
.box{background:#f0f4f8;border:1px solid #b8cce4;border-radius:6px;padding:14px 18px;margin:14px 0}
.metric{display:inline-block;margin:6px 22px 6px 0}
.ml{font-size:11px;color:#888;display:block}
.mv{font-size:20px;font-weight:bold}
.green{color:#1a7a4a}.red{color:#c0392b}
.note{font-size:11px;color:#777;margin:4px 0 8px}
</style></head><body>

<h1>📊 버핏식 내재가치 백테스팅 보고서</h1>
<p class="note">생성: ${now} &nbsp;|&nbsp; 분석: KR ${krSample.length}종목 + US ${usSample.length}종목 &nbsp;|&nbsp; 완료 시뮬레이션: ${completed.length}건 &nbsp;|&nbsp; 진행중: ${partial.length}건</p>

<div class="box">
  <div class="metric"><span class="ml">전체 시뮬 (1년 완료)</span><span class="mv">${completed.length}건</span></div>
  <div class="metric"><span class="ml">매수신호 (MOS+내재가치이하)</span><span class="mv">${buyAll.length}건</span></div>
  <div class="metric"><span class="ml">매수신호 평균 수익률</span><span class="mv ${(stBuy?.avg??0)>=0?"green":"red"}">${fmtSign(stBuy?.avg??null)}</span></div>
  <div class="metric"><span class="ml">매수신호 승률</span><span class="mv ${(stBuy?.winRate??0)>=0.5?"green":"red"}">${fmtPct(stBuy?.winRate??null)}</span></div>
  <div class="metric"><span class="ml">Sharpe</span><span class="mv ${(stBuy?.sharpe??0)>=0?"green":"red"}">${fmt2(stBuy?.sharpe??NaN)}</span></div>
  <div class="metric"><span class="ml">MOS매수 단독 승률</span><span class="mv ${(stMos?.winRate??0)>=0.5?"green":"red"}">${fmtPct(stMos?.winRate??null)} (${stMos?.count??0}건)</span></div>
</div>

<h2>1. 판정 유형별 1년 수익률</h2>
<p class="note">각 연말 버핏 신호 → 다음 해 연말 실제 수익률 (완료 건만)</p>
<table><thead><tr>
  <th>판정</th><th>건수</th><th>평균</th><th>승률</th><th>Sharpe</th><th>중앙값</th><th>최고</th><th>최저</th>
</tr></thead><tbody>
  ${sRow("🟢 안전마진 매수 (MOS ≥25%)", stMos, true)}
  ${sRow("🔵 내재가치 이하 (비MOS)", stBlow)}
  ${sRow("🟡 적정가 근접", stFair)}
  ${sRow("🔴 고평가 (>15% 초과)", stRich)}
  ${sRow("전체 합산", stAll)}
  ${sRow("매수신호 합산 (MOS+이하)", stBuy, true)}
  ${sRow("비매수 합산 (적정+고평가)", stNo)}
</tbody></table>

<h2>2. KR vs US 시장별</h2>
<table><thead><tr>
  <th>시장</th><th>건수</th><th>평균</th><th>승률</th><th>Sharpe</th><th>중앙값</th><th>최고</th><th>최저</th>
</tr></thead><tbody>
  ${sRow("🇰🇷 KR 국내", stKr)}
  ${sRow("🇺🇸 US 미국", stUs)}
</tbody></table>

<h2>3. 연도별 매수신호 수익률 vs 기준 지수</h2>
<p class="note">매수신호 = MOS+내재가치이하 합산 평균. S&P500·KOSPI는 연간 지수 수익률.</p>
<table><thead><tr>
  <th>연도</th><th>매수/전체</th><th>매수 평균</th><th>전체 평균</th>
  <th>S&P500</th><th>KOSPI</th><th>vs S&P알파</th><th>vs KOSPI알파</th>
</tr></thead><tbody>
  ${byYear.map(yrRow).join("")}
</tbody></table>

<h2>4. 안전마진(MOS) 매수 상위 15종목 (수익률 기준)</h2>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th><th>판정</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>진입가</th><th>1년 수익률</th>
</tr></thead><tbody>${topTrades.map(tRow).join("")}</tbody></table>

<h2>5. 안전마진 매수 하위 15종목 (손실 사례)</h2>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th><th>판정</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>진입가</th><th>1년 수익률</th>
</tr></thead><tbody>${botTrades.map(tRow).join("")}</tbody></table>

<h2>6. MOS 매수 신호 전체 (${byV.below_margin.length}건)</h2>
<p class="note">below_margin 판정 전체 내역 — 연도·시장 정렬</p>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>MOS가</th><th>진입가</th>
  <th>저평가율</th><th>1년 수익률</th>
</tr></thead><tbody>
${byV.below_margin.sort((a,b)=>a.simYear-b.simYear||a.market.localeCompare(b.market)).map(t=>`<tr>
  <td style="text-align:center">${t.simYear}</td>
  <td><b>${t.symbol}</b></td><td>${(t.name??"").slice(0,12)}</td>
  <td style="text-align:center">${t.market.toUpperCase()}</td>
  <td>${fmt2(t.eps0)}</td><td>${fmtPct(t.growth10y)}</td>
  <td>${fmt2(t.intrinsic)}</td><td>${fmt2(t.mosPrice)}</td><td>${fmt2(t.entryPrice)}</td>
  <td style="color:#1a7a4a">${fmtSign(t.gap)}</td>
  <td style="color:${t.ret1y>=0?"#1a7a4a":"#c0392b"}">${fmtSign(t.ret1y)}</td>
</tr>`).join("")}
</tbody></table>

<h2>7. 내재가치이하 신호 전체 (${byV.below_intrinsic.length}건)</h2>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>진입가</th>
  <th>저평가율</th><th>1년 수익률</th>
</tr></thead><tbody>
${byV.below_intrinsic.sort((a,b)=>a.simYear-b.simYear).map(t=>`<tr>
  <td style="text-align:center">${t.simYear}</td>
  <td><b>${t.symbol}</b></td><td>${(t.name??"").slice(0,12)}</td>
  <td style="text-align:center">${t.market.toUpperCase()}</td>
  <td>${fmt2(t.eps0)}</td><td>${fmtPct(t.growth10y)}</td>
  <td>${fmt2(t.intrinsic)}</td><td>${fmt2(t.entryPrice)}</td>
  <td style="color:#1a7a4a">${fmtSign(t.gap)}</td>
  <td style="color:${t.ret1y>=0?"#1a7a4a":"#c0392b"}">${fmtSign(t.ret1y)}</td>
</tr>`).join("")}
</tbody></table>

<h2>8. 전체 시뮬레이션 상세 (${completed.length}건)</h2>
<p class="note">연도·시장·심볼 정렬 — 모든 시뮬레이션 결과 (1년 완료 기준)</p>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th><th>판정</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>진입가</th><th>1년 수익률</th>
</tr></thead><tbody>
${fullDetail.map(tRow).join("")}
</tbody></table>

${partial.length>0?`<h2>9. 진행중 시뮬레이션 (${partial.length}건 — 아직 1년 미완료)</h2>
<p class="note">simYear=2025 이상 — 수익률은 현재 시점 기준 잠정값</p>
<table><thead><tr>
  <th>연도</th><th>심볼</th><th>종목명</th><th>시장</th><th>판정</th>
  <th>EPS</th><th>성장률</th><th>내재가치</th><th>진입가</th><th>현재 수익률</th>
</tr></thead><tbody>
${partial.sort((a,b)=>a.simYear-b.simYear).map(tRow).join("")}
</tbody></table>`:""}

<h2>방법론 &amp; 주의사항</h2>
<div class="box" style="font-size:12px">
<b>백테스팅 방법론</b>
<ul style="margin:6px 0">
  <li><b>유니버스</b>: KR 시총 상위 ${krSample.length}종목 + US S&P500 구성 ${usSample.length}종목</li>
  <li><b>EPS 출처</b>: KR — Naver 연간 재무제표 (서버 loadBuffettIntrinsicValue) / US — Yahoo incomeStatementHistory + 발행주식수</li>
  <li><b>가격 데이터</b>: Yahoo Finance v8 월봉 수정주가 — 12월(없으면 11·10월) 종가</li>
  <li><b>할인율</b>: 시뮬레이션 연도 실제 10년 국채 수익률 (US ^TNX / KR 국고채10년)</li>
  <li><b>성장률</b>: 가용 연간 EPS CAGR (2개 이상 데이터 포인트 필요)</li>
  <li><b>잔여성장률</b>: CAGR × 1/3, 상한 5%</li>
  <li><b>안전마진</b>: 내재가치의 25% 할인가 이하를 MOS 매수 신호로 분류</li>
  <li><b>수익률</b>: 시뮬 연도 연말 → 다음 해 연말 주가 기준 (수정주가)</li>
  <li><b>부채 차감</b>: 생략 (역사적 재무제표 데이터 제약)</li>
</ul>
<b>주의</b>
<ul style="margin:6px 0">
  <li>생존 편향: 현재 유니버스에 남아있는 종목만 분석 → 실제보다 낙관적일 수 있음</li>
  <li>데이터 제약: Yahoo incomeStatementHistory는 최근 4년만 제공 → 시뮬레이션 연도 범위 제한됨</li>
  <li>KR 종목은 2023년 이후 EPS 데이터만 가용한 경우가 많아 시뮬레이션 포인트가 적음</li>
  <li>거래비용·세금·슬리피지 미반영 / 투자 권유 아님</li>
</ul>
</div>

<p style="color:#aaa;font-size:11px;margin-top:16px">YSTOCK 자동 생성 | ${now}</p>
</body></html>`;

// ─── 발송 ─────────────────────────────────────────────────────────────────────
console.log("\n=== 이메일 발송 ===");
if (!isEmailSendingConfigured()) {
  console.error("이메일 미설정. HTML만 출력:");
  console.log(html.slice(0,2000));
  process.exit(0);
}
if (DRY_RUN) {
  console.log("[DRY-RUN]");
  console.log(html.slice(0,3000));
  process.exit(0);
}

await sendTransactionalEmail({
  to: TO,
  subject: `[YSTOCK] 버핏 내재가치 백테스팅 — ${completed.length}건 분석 | 매수신호 평균 ${fmtSign(stBuy?.avg??null)} 승률 ${fmtPct(stBuy?.winRate??null)}`,
  html,
  text: `버핏식 내재가치 백테스팅\n완료: ${completed.length}건 | 매수신호: ${buyAll.length}건 | 평균수익률: ${fmtSign(stBuy?.avg??null)} | 승률: ${fmtPct(stBuy?.winRate??null)} | Sharpe: ${fmt2(stBuy?.sharpe??NaN)}`,
});

console.log(`발송 완료 → ${TO}`);
