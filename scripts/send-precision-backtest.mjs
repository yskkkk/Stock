#!/usr/bin/env node
/**
 * 정밀 백테스팅 — 실매매 적용 시 기대치와 차이 분석
 *
 * 분석 항목:
 *  A. PRO vs V2 탐지 성과 비교 (walk-forward)
 *  B. confirming 지연 효과 (bar-based 정확한 시뮬)
 *  C. 30분 스캔 딜레이 영향 (박스 탐지 → 실매매 반영 지연)
 *  D. 슬리피지 민감도 (진입가 bottom+0~0.5%)
 *  E. dipLow 틱 정밀도 차이 (봉 단위 vs 틱 단위)
 *
 * node scripts/send-precision-backtest.mjs
 */
import { loadEnvFile }            from "../server/load-env.js";
import { sendTransactionalEmail } from "../server/email-sender.js";
import { fetchBinanceUsdtChart }  from "../server/binance-usdt.js";
import { loadStock }              from "../server/stock-data.js";
import { detectBoxRangeProAt }    from "../server/box-range/detect-pro.js";
import { detectBoxV2At }          from "../server/box-range/box-range-v2-core.js";
import {
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_CONFIRM_MIN_MS,
} from "../server/box-range/constants.js";
import { normalizeBoxUnixTime }   from "../server/box-range/box-time.js";

loadEnvFile();
const TO  = "samron3797@gmail.com";
const ts  = new Date().toISOString().slice(0, 16).replace("T", " ");
const fmt  = (n, d=2) => Number.isFinite(n) ? n.toFixed(d) : "—";
const fmtP = (n, d=2) => Number.isFinite(n) ? `${n>=0?"+":""}${n.toFixed(d)}%` : "—";
const pct  = (a, b)   => b > 0 ? ((a-b)/b*100) : 0;

// ══════════════════════════════════════════════════════════════════════
// 캔들 로더
// ══════════════════════════════════════════════════════════════════════
async function loadCandles(sym, tf) {
  try {
    if (sym.endsWith("-USDT")) {
      const d = await fetchBinanceUsdtChart(sym, tf);
      return (d?.candles ?? []).map(c => {
        const t = normalizeBoxUnixTime(c.time);
        return t ? {...c, time: t} : null;
      }).filter(Boolean);
    }
    const d = await loadStock(sym, tf, { live: true, boxRangeScan: true });
    return (d?.candles ?? []).map(c => {
      const t = normalizeBoxUnixTime(c.time);
      return t ? {...c, time: t} : null;
    }).filter(Boolean);
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════════════
// FSM 시뮬레이션
// mode: "base" | "confirm" | "delay30m" | "slippage" | "tickDipLow"
// ══════════════════════════════════════════════════════════════════════
function simulateFSM(candles, startI, box, mode = "base", slippagePct = 0) {
  const { top, bottom } = box;
  const trades = [];
  let state = "idle", dipLow = NaN, entryPrice = NaN;
  let confirmingBar = -1; // bar index when confirming started

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];

    if (state === "idle") {
      const afterBox = c.time > box.rightTime;
      if (afterBox && c.close <= bottom) {
        state = "armed";
        dipLow = c.close;
      }
      continue;
    }

    if (state === "armed") {
      if (c.low < dipLow || isNaN(dipLow)) {
        // tickDipLow mode: use bar low (as if tick-precise)
        dipLow = mode === "tickDipLow" ? c.low : c.close;
      }

      if (c.close >= bottom) {
        if (mode === "confirm") {
          // bar-based confirming: must see next bar also >= bottom
          state = "confirming";
          confirmingBar = i;
          continue;
        }
        // base/slippage/delay: enter immediately
        entryPrice = bottom * (1 + slippagePct / 100);
        state = "in_position";
      }
      continue;
    }

    if (state === "confirming") {
      if (c.close < bottom) {
        // fake recovery → back to armed
        state = "armed";
        dipLow = Math.min(dipLow, c.low);
        confirmingBar = -1;
        continue;
      }
      if (i > confirmingBar) {
        // confirmed: enter on the next bar after confirming
        entryPrice = bottom * (1 + slippagePct / 100);
        state = "in_position";
        confirmingBar = -1;
      }
      continue;
    }

    if (state === "in_position") {
      const sl = isNaN(dipLow) ? bottom * 0.97 : dipLow;
      if (c.high >= top) {
        trades.push({ pnl: (top - entryPrice) / entryPrice * 100, win: true, bars: i - startI });
        // reset for re-entry (PRO v2)
        state = "idle"; dipLow = NaN; entryPrice = NaN;
        continue;
      }
      if (c.low <= sl) {
        trades.push({ pnl: (sl - entryPrice) / entryPrice * 100, win: false, bars: i - startI });
        return trades; // dead box
      }
    }
  }
  return trades;
}

// ══════════════════════════════════════════════════════════════════════
// walk-forward 박스 탐지 + FSM 실행
// ══════════════════════════════════════════════════════════════════════
function runWalkForward(candles, tf, detectFn, mode, slippagePct = 0) {
  const allTrades = [];
  let i = candles.length - 2;

  while (i >= BOX_RANGE_MIN_BARS + 5) {
    const res = detectFn(candles, i, tf);
    if (!res) { i -= Math.max(1, Math.floor((candles.length - i) / 20) || 3); continue; }

    const box = res.box;
    const trades = simulateFSM(candles, i + 1, box, mode, slippagePct);
    allTrades.push(...trades);
    i = res.startIdx - 1;
  }
  return allTrades;
}

function stats(trades) {
  if (!trades.length) return { n:0, wr:NaN, avg:NaN, pf:NaN, exp:NaN };
  const wins  = trades.filter(t => t.win);
  const losses= trades.filter(t => !t.win);
  const wr    = wins.length / trades.length * 100;
  const avg   = trades.reduce((s,t)=>s+t.pnl, 0) / trades.length;
  const gwAbs = wins.reduce((s,t)=>s+t.pnl, 0);
  const glAbs = Math.abs(losses.reduce((s,t)=>s+t.pnl, 0));
  const pf    = glAbs > 0 ? gwAbs / glAbs : gwAbs > 0 ? Infinity : 0;
  const exp   = (wr/100)*(gwAbs/(wins.length||1)) - ((100-wr)/100)*(glAbs/(losses.length||1));
  return { n: trades.length, wr, avg, pf, exp };
}

// ══════════════════════════════════════════════════════════════════════
// 대상 심볼
// ══════════════════════════════════════════════════════════════════════
const SYMBOLS = [
  { sym: "BTC-USDT", tf: "1d", market: "crypto" },
  { sym: "BTC-USDT", tf: "4h", market: "crypto" },
  { sym: "ETH-USDT", tf: "1d", market: "crypto" },
  { sym: "ETH-USDT", tf: "4h", market: "crypto" },
  { sym: "SOL-USDT", tf: "1d", market: "crypto" },
  { sym: "SOL-USDT", tf: "4h", market: "crypto" },
  { sym: "AAPL",     tf: "1d", market: "us" },
  { sym: "NVDA",     tf: "1d", market: "us" },
  { sym: "MSFT",     tf: "1d", market: "us" },
  { sym: "GOOGL",    tf: "1d", market: "us" },
  { sym: "AMZN",     tf: "1d", market: "us" },
  { sym: "TSLA",     tf: "1d", market: "us" },
  { sym: "005930.KS",tf: "1d", market: "kr" }, // 삼성전자
  { sym: "000660.KS",tf: "1d", market: "kr" }, // SK하이닉스
  { sym: "035420.KS",tf: "1d", market: "kr" }, // NAVER
];

// ══════════════════════════════════════════════════════════════════════
// 30분 딜레이 시뮬 — 박스가 형성된 후 30분 후에야 탐지된다고 가정
// 실제로는 박스 rightTime + 30분 이후에만 FSM이 작동
// ══════════════════════════════════════════════════════════════════════
function runWalkForwardWithDelay(candles, tf, detectFn, delaySec = 1800) {
  // tf별 봉 시간(초)
  const barSec = tf === "1d" ? 86400 : tf === "4h" ? 14400 : 3600;
  const delayBars = Math.ceil(delaySec / barSec); // 딜레이에 해당하는 봉 수

  const allTrades = [];
  let i = candles.length - 2;

  while (i >= BOX_RANGE_MIN_BARS + 5) {
    const res = detectFn(candles, i, tf);
    if (!res) { i -= 3; continue; }

    const box = res.box;
    // FSM 시작을 delayBars 뒤로 미룸
    const fsmStart = Math.min(i + 1 + delayBars, candles.length - 1);
    const trades = simulateFSM(candles, fsmStart, box, "base");
    allTrades.push(...trades);
    i = res.startIdx - 1;
  }
  return allTrades;
}

// ══════════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════════
console.log(`[정밀백테스팅] ${ts} 시작`);

const rows = [];

for (const { sym, tf, market } of SYMBOLS) {
  process.stdout.write(`  ${sym}/${tf}...`);
  const candles = await loadCandles(sym, tf);
  if (candles.length < 30) { process.stdout.write(" 데이터부족\n"); continue; }

  const proFn = (c, i, t) => detectBoxRangeProAt(c, i, t);
  const v2Fn  = (c, i, t) => detectBoxV2At(c, i, t);

  // A. PRO base
  const tPro   = runWalkForward(candles, tf, proFn, "base");
  // B. V2 base
  const tV2    = runWalkForward(candles, tf, v2Fn,  "base");
  // C. V2 + confirming (bar-based)
  const tConf  = runWalkForward(candles, tf, v2Fn,  "confirm");
  // D. V2 + 30분 딜레이
  const tDelay = runWalkForwardWithDelay(candles, tf, v2Fn);
  // E. V2 + 슬리피지 0.2%
  const tSlip  = runWalkForward(candles, tf, v2Fn,  "base", 0.2);
  // F. V2 + tickDipLow (봉 저가로 SL 추적 — 틱 정밀 근사)
  const tTick  = runWalkForward(candles, tf, v2Fn,  "tickDipLow");

  rows.push({
    sym, tf, market,
    pro:   stats(tPro),
    v2:    stats(tV2),
    conf:  stats(tConf),
    delay: stats(tDelay),
    slip:  stats(tSlip),
    tick:  stats(tTick),
    candles: candles.length,
  });
  process.stdout.write(` PRO:${tPro.length}t V2:${tV2.length}t Conf:${tConf.length}t\n`);
}

console.log(`\n[완료] ${rows.length}개 심볼 분석`);

// ══════════════════════════════════════════════════════════════════════
// 집계 — 전체 합산
// ══════════════════════════════════════════════════════════════════════
function aggregate(rows, key) {
  const all = rows.flatMap(r => {
    const s = r[key];
    // 역산: avg, wr, n으로 개별 trades 복원 불가 → 가중평균
    return [];
  });
  // 단순 평균
  const valid = rows.filter(r => r[key].n > 0);
  if (!valid.length) return { n:0, wr:NaN, avg:NaN, pf:NaN, exp:NaN };
  return {
    n:   valid.reduce((s,r)=>s+r[key].n, 0),
    wr:  valid.reduce((s,r)=>s+r[key].wr, 0) / valid.length,
    avg: valid.reduce((s,r)=>s+r[key].avg, 0) / valid.length,
    pf:  valid.reduce((s,r)=>s+r[key].pf, 0) / valid.length,
    exp: valid.reduce((s,r)=>s+r[key].exp, 0) / valid.length,
  };
}

const agg = {
  pro:   aggregate(rows, "pro"),
  v2:    aggregate(rows, "v2"),
  conf:  aggregate(rows, "conf"),
  delay: aggregate(rows, "delay"),
  slip:  aggregate(rows, "slip"),
  tick:  aggregate(rows, "tick"),
};

// ══════════════════════════════════════════════════════════════════════
// HTML 이메일
// ══════════════════════════════════════════════════════════════════════
const CSS = `
body{font-family:-apple-system,Arial,sans-serif;background:#0f0f14;color:#e0e0e0;margin:0;padding:20px;font-size:12px}
h1{color:#7eb8f7;font-size:17px;border-bottom:1px solid #2a3a5c;padding-bottom:8px}
h2{color:#a0b8d8;font-size:13px;margin:20px 0 8px;border-left:3px solid #3a6a9c;padding-left:8px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#1a2235;color:#7a8fa8;text-align:center;padding:6px 8px;border-bottom:1px solid #2a3a5c;font-size:11px}
th.left{text-align:left}
td{padding:5px 8px;border-bottom:1px solid #151e2e;text-align:center;font-size:11px}
td.sym{text-align:left;font-weight:600;color:#c8d8e8}
.pos{color:#5cb85c}.neg{color:#e05050}.neu{color:#e8a030}.dim{color:#4a6a8c}
.hi{background:#1a2a50}.warn{background:#2a1a10}
.tag{display:inline-block;border-radius:3px;padding:1px 5px;font-size:10px}
.tag-ok{background:#1a4020;color:#5cb85c}.tag-warn{background:#3a2a10;color:#e8a030}.tag-bad{background:#3a1010;color:#e05050}
.section{background:#0d1420;border:1px solid #1a2a40;border-radius:5px;padding:12px;margin-bottom:14px}
.note{color:#5a7a9a;font-size:10px;margin-top:4px}
`;

function clr(v, goodIfPos = true) {
  if (!Number.isFinite(v)) return 'dim';
  if (goodIfPos) return v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : 'neu';
  return v < -0.5 ? 'pos' : v > 0.5 ? 'neg' : 'neu';
}

function fmtRow(r) {
  const cols = ['pro','v2','conf','delay','slip','tick'];
  const labels = ['PRO','V2','V2+확인','V2+30분딜','V2+슬립0.2%','V2+틱SL'];
  return `
    <tr>
      <td class="sym">${r.sym}</td>
      <td class="dim">${r.tf}</td>
      <td class="dim">${r.candles}</td>
      ${cols.map(k => {
        const s = r[k];
        if (s.n === 0) return '<td class="dim" colspan="4">—</td>';
        return `
          <td>${s.n}</td>
          <td class="${clr(s.wr-50)}">${fmt(s.wr)}%</td>
          <td class="${clr(s.avg)}">${fmtP(s.avg)}</td>
          <td class="${clr(s.exp)}">${fmtP(s.exp)}</td>
        `;
      }).join('')}
    </tr>`;
}

function aggRow(label, s, highlight=false) {
  if (s.n === 0) return `<tr class="${highlight?'hi':''}"><td class="sym" colspan="5">${label}: 데이터 없음</td></tr>`;
  return `<tr class="${highlight?'hi':''}">
    <td class="sym" colspan="2">${label}</td>
    <td>${s.n}거래</td>
    <td class="${clr(s.wr-50)}">${fmt(s.wr)}%</td>
    <td class="${clr(s.avg)}">${fmtP(s.avg)}</td>
    <td class="${clr(s.pf)}">${fmt(s.pf)}배</td>
    <td class="${clr(s.exp)}">${fmtP(s.exp)}</td>
  </tr>`;
}

// 실매매 차이 분석 테이블
function diffTag(v2val, liveVal, label, lowerIsBetter=false) {
  const diff = liveVal - v2val;
  const sign = lowerIsBetter ? -diff : diff;
  const cls = sign > 0.3 ? 'tag-ok' : sign < -0.3 ? 'tag-bad' : 'tag-warn';
  const arrow = diff > 0.3 ? '▲' : diff < -0.3 ? '▼' : '≈';
  return `<span class="tag ${cls}">${arrow} ${label}: ${fmt(diff, 2)}</span>`;
}

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>정밀 백테스팅</title><style>${CSS}</style></head><body>
<h1>🔬 정밀 백테스팅 — 실매매 기대치 차이 분석</h1>
<p style="color:#5a7a9a;font-size:10px">${ts} · ${SYMBOLS.length}개 심볼 × 6가지 시뮬</p>

<!-- 종합 집계 -->
<h2>종합 비교 (전 심볼 평균)</h2>
<div class="section">
<table>
  <tr>
    <th class="left" colspan="2">모드</th>
    <th>거래수</th><th>승률</th><th>평균수익</th><th>손익비</th><th>기대수익</th>
  </tr>
  ${aggRow("① PRO (기존)", agg.pro)}
  ${aggRow("② V2 (ER+POC)", agg.v2)}
  ${aggRow("③ V2 + 확인캔들 (실서버)", agg.conf, true)}
  ${aggRow("④ V2 + 30분 스캔딜레이", agg.delay)}
  ${aggRow("⑤ V2 + 슬리피지 0.2%", agg.slip)}
  ${aggRow("⑥ V2 + 틱단위 SL추적", agg.tick)}
</table>
<p class="note">③이 실서버 구현체와 동일한 로직 (V2탐지 + bar-based 확인캔들)</p>
</div>

<!-- 실매매 차이 분석 -->
<h2>실매매 적용 시 기대치 차이 분석</h2>
<div class="section">
<table>
  <tr><th class="left">요인</th><th>설명</th><th>영향</th><th>평균수익 차이</th><th>승률 차이</th><th>판정</th></tr>
  <tr>
    <td class="sym">30분 스캔 딜레이</td>
    <td>박스 탐지 후 최대 30분 뒤에야 FSM 작동</td>
    <td>이탈 직후 빠른 복귀 신호 일부 놓침</td>
    <td class="${clr(agg.delay.avg - agg.v2.avg)}">${fmtP(agg.delay.avg - agg.v2.avg)}</td>
    <td class="${clr(agg.delay.wr - agg.v2.wr)}">${fmt(agg.delay.wr - agg.v2.wr)}%p</td>
    <td><span class="tag ${Math.abs(agg.delay.avg - agg.v2.avg) < 0.5 ? 'tag-ok' : 'tag-warn'}">${Math.abs(agg.delay.avg - agg.v2.avg) < 0.5 ? '미미' : '주의'}</span></td>
  </tr>
  <tr>
    <td class="sym">슬리피지 0.2%</td>
    <td>시장가 진입 시 bottom 대비 0.2% 높게 체결</td>
    <td>수익률 직접 감소</td>
    <td class="${clr(agg.slip.avg - agg.v2.avg)}">${fmtP(agg.slip.avg - agg.v2.avg)}</td>
    <td class="${clr(agg.slip.wr - agg.v2.wr)}">${fmt(agg.slip.wr - agg.v2.wr)}%p</td>
    <td><span class="tag ${Math.abs(agg.slip.avg - agg.v2.avg) < 0.5 ? 'tag-ok' : 'tag-warn'}">${Math.abs(agg.slip.avg - agg.v2.avg) < 0.5 ? '미미' : '주의'}</span></td>
  </tr>
  <tr>
    <td class="sym">틱 단위 SL 추적</td>
    <td>dipLow를 봉 종가 대신 봉 저가 기준으로 추적 (틱 근사)</td>
    <td>SL이 더 낮게 잡혀 조기손절 가능성↑</td>
    <td class="${clr(agg.tick.avg - agg.v2.avg)}">${fmtP(agg.tick.avg - agg.v2.avg)}</td>
    <td class="${clr(agg.tick.wr - agg.v2.wr)}">${fmt(agg.tick.wr - agg.v2.wr)}%p</td>
    <td><span class="tag ${Math.abs(agg.tick.avg - agg.v2.avg) < 0.5 ? 'tag-ok' : 'tag-warn'}">${Math.abs(agg.tick.avg - agg.v2.avg) < 0.5 ? '미미' : '주의'}</span></td>
  </tr>
  <tr>
    <td class="sym">확인캔들 시간 대기</td>
    <td>clock-based 1봉 대기 (주말·공휴일 문제 없음)</td>
    <td>진입 타이밍 지연 → 승률 변화</td>
    <td class="${clr(agg.conf.avg - agg.v2.avg)}">${fmtP(agg.conf.avg - agg.v2.avg)}</td>
    <td class="${clr(agg.conf.wr - agg.v2.wr)}">${fmt(agg.conf.wr - agg.v2.wr)}%p</td>
    <td><span class="tag ${agg.conf.avg >= agg.v2.avg ? 'tag-ok' : 'tag-warn'}">${agg.conf.avg >= agg.v2.avg ? '개선' : '주의'}</span></td>
  </tr>
</table>
<p class="note">✱ 복합 효과: 실매매는 위 4가지 요인이 동시 적용됨. 개별 영향 합산보다 실제 차이가 클 수 있음</p>
</div>

<!-- 심볼별 상세 -->
<h2>심볼별 상세</h2>
<div style="overflow-x:auto">
<table>
  <tr>
    <th class="left">심볼</th><th>TF</th><th>봉수</th>
    ${['PRO','V2','V2+확인','V2+딜레이','V2+슬립','V2+틱SL'].map(l =>
      `<th colspan="4" style="border-left:1px solid #2a3a5c">${l}</th>`
    ).join('')}
  </tr>
  <tr>
    <th colspan="3"></th>
    ${Array(6).fill('<th>N</th><th>승률</th><th>평균</th><th>기대</th>').join('')}
  </tr>
  ${rows.map(fmtRow).join('')}
</table>
</div>

<!-- 결론 -->
<h2>결론 및 권고</h2>
<div class="section">
<table>
  <tr><th class="left">항목</th><th>현황</th><th>권고</th></tr>
  <tr>
    <td class="sym">탐지 알고리즘</td>
    <td>PRO(88/12%) + V2(ER+POC) 병렬 운영</td>
    <td>✅ 현행 유지 — PRO는 기존 신호, V2는 추가 필터 신호</td>
  </tr>
  <tr>
    <td class="sym">확인캔들 (confirming)</td>
    <td>clock-based: 1h=1시간, 4h=4시간, 1d=24시간</td>
    <td>${agg.conf.avg >= agg.v2.avg ? '✅ 개선 효과 확인 — 유지' : '⚠️ 수익률 소폭 하락 — 모니터링 필요'}</td>
  </tr>
  <tr>
    <td class="sym">30분 스캔 딜레이</td>
    <td>카탈로그 갱신 주기 30분</td>
    <td>${Math.abs(agg.delay.avg - agg.v2.avg) < 0.5 ? '✅ 영향 미미 — 현행 유지' : '⚠️ 스캔 주기 단축 검토 (15분)'}</td>
  </tr>
  <tr>
    <td class="sym">슬리피지</td>
    <td>시장가 진입 (0~0.3% 예상)</td>
    <td>${Math.abs(agg.slip.avg - agg.v2.avg) < 0.5 ? '✅ 영향 미미' : '⚠️ 지정가 진입 검토'}</td>
  </tr>
  <tr>
    <td class="sym">dipLow SL</td>
    <td>틱 단위 최솟값 추적</td>
    <td>${Math.abs(agg.tick.avg - agg.v2.avg) < 0.5 ? '✅ 봉 종가와 차이 미미' : '⚠️ 봉 저가 기준 SL이 더 타이트 — 조기손절 주의'}</td>
  </tr>
</table>
</div>

<p style="color:#3a4a5c;font-size:10px;margin-top:20px;border-top:1px solid #1a2235;padding-top:10px">
YSTOCK 정밀 백테스팅 · ${ts}
</p>
</body></html>`;

const subject = `[YSTOCK] 정밀 백테스팅 — 실매매 기대치 차이 분석 (${ts})`;
const lines = [
  `[YSTOCK] 정밀 백테스팅 (${ts})`,
  ``,
  `종합 평균:`,
  `  PRO:      N=${agg.pro.n}  승률=${fmt(agg.pro.wr)}%  평균=${fmtP(agg.pro.avg)}  기대=${fmtP(agg.pro.exp)}`,
  `  V2:       N=${agg.v2.n}  승률=${fmt(agg.v2.wr)}%  평균=${fmtP(agg.v2.avg)}  기대=${fmtP(agg.v2.exp)}`,
  `  V2+확인:  N=${agg.conf.n}  승률=${fmt(agg.conf.wr)}%  평균=${fmtP(agg.conf.avg)}  기대=${fmtP(agg.conf.exp)}`,
  `  딜레이차: ${fmtP(agg.delay.avg - agg.v2.avg)}  슬리피지차: ${fmtP(agg.slip.avg - agg.v2.avg)}  틱SL차: ${fmtP(agg.tick.avg - agg.v2.avg)}`,
];
const text = lines.join('\n');

await sendTransactionalEmail({ to: TO, subject, text, html });
console.log(`✓ 이메일 전송 → ${TO}`);
