#!/usr/bin/env node
/**
 * 실제 가격 데이터 백테스팅 + ⑦ 구현 계획 이메일 (2통)
 * BTC·ETH·SOL + S&P500 대표 5종목 × 1h·1d
 * node scripts/send-backtest-real.mjs --to samron3797@gmail.com
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { fetchBinanceUsdtChart } from "../server/binance-usdt.js";
import { loadStock } from "../server/stock-data.js";
import { detectBoxRangesProOnCandles, detectBoxRangeProAt } from "../server/box-range/detect-pro.js";
import { BOX_RANGE_MIN_BARS, BOX_RANGE_PRO_MIN_REJECTIONS } from "../server/box-range/constants.js";

loadEnvFile();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let to = "samron3797@gmail.com";
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) to = args[toIdx + 1].trim();

const fmt  = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const fmtS = (n, d = 2) => (Number.isFinite(n) ? (n >= 0 ? `+${fmt(n,d)}` : fmt(n,d)) : "—");
const fmtP = (n, d = 2) => `${fmtS(n, d)}%`;

// ══════════════════════════════════════════════════════════════════════
// FSM 시뮬레이터 — 캔들 배열 + 박스 + 모델 파라미터
// ══════════════════════════════════════════════════════════════════════
/**
 * @param {object[]} candles  OHLC 배열 (전체)
 * @param {number}   startI   박스 종료 직후 bar index
 * @param {object}   box      { top, bottom, mid }
 * @param {object}   model    { trigger, slBuffer, maxReentry, label }
 * @returns {{ trades: {type,pnl}[], triggered: boolean, entered: boolean }}
 */
function simulateFSM(candles, startI, box, model) {
  const { top, bottom, mid } = box;
  const { trigger, slBuffer, maxReentry } = model; // trigger: 'mid' | 'bottom'

  const trades = [];
  let state = "idle";   // idle → armed → position → (idle for re-entry) | dead
  let dipLow = NaN;
  let entryPrice = NaN;
  let reentryCount = 0;
  let triggered = false;
  let entered = false;

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    if (state === "idle") {
      if (trigger === "mid") {
        // Legacy: 중심선에 고가~저가 사이에 mid가 포함되면 즉시 진입
        if (c.low <= mid && c.high >= mid) {
          state = "position";
          entryPrice = mid;
          triggered = true;
          entered = true;
        }
      } else {
        // PRO v2: 하단 이탈 → armed
        if (c.low <= bottom) {
          state = "armed";
          dipLow = c.low;
          triggered = true;
        }
      }
    } else if (state === "armed") {
      // dipLow 갱신
      if (c.low < dipLow) dipLow = c.low;
      // 하단 위 복귀 → 진입
      if (c.close >= bottom) {
        if (maxReentry !== Infinity && reentryCount >= maxReentry) {
          state = "dead"; break;
        }
        state = "position";
        entryPrice = bottom;
        reentryCount++;
        entered = true;
      }
    } else if (state === "position") {
      // SL 기준
      const slLevel = trigger === "mid"
        ? bottom                              // Legacy: box 하단
        : dipLow * (1 - slBuffer);           // PRO v2: dipLow + 버퍼

      // TP 먼저 체크 (같은 봉에서 둘 다면 TP 우선)
      if (c.high >= top) {
        const pnl = ((top - entryPrice) / entryPrice) * 100;
        trades.push({ type: "TP", pnl, entry: entryPrice, exit: top });
        if (maxReentry === 0) { state = "dead"; break; }
        // 재진입 허용 시 idle 리셋
        state = "idle";
        dipLow = NaN;
        entryPrice = NaN;
      } else if (Number.isFinite(slLevel) && c.low <= slLevel) {
        const exitPrice = slLevel;
        const pnl = ((exitPrice - entryPrice) / entryPrice) * 100;
        trades.push({ type: "SL", pnl, entry: entryPrice, exit: exitPrice });
        state = "dead"; break;
      }
    } else if (state === "dead") {
      break;
    }
  }
  return { trades, triggered, entered };
}

// ══════════════════════════════════════════════════════════════════════
// 박스 히스토리 추출 — walk-forward
// ══════════════════════════════════════════════════════════════════════
function extractHistoricalBoxes(candles, timeframe) {
  const boxes = [];
  const seen = new Set();
  // 각 bar에서 detectBoxRangeProAt 호출 → 박스 완성 시점 포착
  const step = timeframe === "1h" ? 3 : 1; // 1h는 3봉 건너뜀 (속도)
  for (let i = BOX_RANGE_MIN_BARS + 10; i < candles.length - 2; i += step) {
    const result = detectBoxRangeProAt(candles, i, timeframe);
    if (!result) continue;
    const { box, startIdx } = result;
    const key = `${startIdx}-${i}-${box.top.toFixed(4)}-${box.bottom.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boxes.push({ box, startIdx, endIdx: i });
  }
  return boxes;
}

// ══════════════════════════════════════════════════════════════════════
// 모델 정의 (7개)
// ══════════════════════════════════════════════════════════════════════
const MODELS = [
  { id: 1, label: "① Legacy",          trigger: "mid",    slBuffer: 0,    maxReentry: 0,        badge: "#78716c" },
  { id: 2, label: "② PRO v2 재진입↑",  trigger: "bottom", slBuffer: 0,    maxReentry: Infinity, badge: "#2563eb" },
  { id: 3, label: "③ PRO v2 재진입✕",  trigger: "bottom", slBuffer: 0,    maxReentry: 0,        badge: "#7c3aed" },
  { id: 4, label: "④ TF분리",          trigger: "bottom", slBuffer: 0,    maxReentry: null,     badge: "#0891b2" }, // maxReentry=null: TF별 처리
  { id: 5, label: "⑤ TF분리+상한3",    trigger: "bottom", slBuffer: 0,    maxReentry: null,     badge: "#059669" }, // null + cap=3
  { id: 6, label: "⑥ +dipLow버퍼",     trigger: "bottom", slBuffer: 0.05, maxReentry: null,     badge: "#d97706" },
  { id: 7, label: "⑦ 풀 최적화",       trigger: "bottom", slBuffer: 0.05, maxReentry: null,     badge: "#dc2626" },
];

function modelForTF(modelDef, tf) {
  if (modelDef.maxReentry !== null) return modelDef;
  // TF분리 계열: 1h → 재진입✕, 4h/1d → cap
  const cap = (modelDef.id >= 5) ? 3 : Infinity; // ④: unlimited for 4h/1d, ⑤⑥⑦: max3
  return {
    ...modelDef,
    maxReentry: tf === "1h" ? 0 : cap,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 심볼별 백테스팅 실행
// ══════════════════════════════════════════════════════════════════════
async function backtestSymbol(symbol, timeframe, isCrypto) {
  let chartData;
  try {
    chartData = isCrypto
      ? await fetchBinanceUsdtChart(symbol, timeframe)
      : await loadStock(symbol, timeframe);
  } catch (e) {
    return { symbol, timeframe, error: e.message, results: [] };
  }

  const candles = chartData.candles ?? [];
  if (candles.length < BOX_RANGE_MIN_BARS + 20) {
    return { symbol, timeframe, error: "캔들 부족", results: [] };
  }

  // 박스 추출 (최신 60박스까지)
  const historicalBoxes = extractHistoricalBoxes(candles, timeframe);
  if (!historicalBoxes.length) {
    return { symbol, timeframe, error: "박스 없음", results: [] };
  }

  // 모델별 시뮬
  const modelResults = MODELS.map(modelDef => {
    const m = modelForTF(modelDef, timeframe);
    let trades = [], triggered = 0, entered = 0;

    for (const { box, endIdx } of historicalBoxes) {
      const startI = Math.min(endIdx + 1, candles.length - 1);
      const sim = simulateFSM(candles, startI, box, m);
      trades.push(...sim.trades);
      if (sim.triggered) triggered++;
      if (sim.entered) entered++;
    }

    const wins   = trades.filter(t => t.type === "TP").length;
    const losses = trades.filter(t => t.type === "SL").length;
    const total  = trades.length;
    const winRate = total > 0 ? wins / total * 100 : 0;
    const avgPnl = total > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / total : 0;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const avgTP  = wins > 0 ? trades.filter(t => t.type === "TP").reduce((s,t) => s+t.pnl, 0) / wins : 0;
    const avgSL  = losses > 0 ? trades.filter(t => t.type === "SL").reduce((s,t) => s+t.pnl, 0) / losses : 0;
    const expectancy = winRate/100 * avgTP + (1-winRate/100) * avgSL;

    return {
      modelId: modelDef.id,
      label: modelDef.label,
      badge: modelDef.badge,
      boxes: historicalBoxes.length,
      triggered, entered,
      total, wins, losses,
      winRate, avgPnl, totalPnl, avgTP, avgSL, expectancy,
    };
  });

  return { symbol, timeframe, candles: candles.length, boxes: historicalBoxes.length, results: modelResults };
}

// ══════════════════════════════════════════════════════════════════════
// 이메일 1: ⑦ 구현 계획
// ══════════════════════════════════════════════════════════════════════
function buildImplPlanEmail(now) {
  const subject = `[YSTOCK] ⑦ 풀 최적화 구현 계획 — 재작성 필요 없음 (${now})`;
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title>
<style>
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:900px;margin:0 auto;padding:24px 18px;background:#f8fafc;}
h1{font-size:1.25em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:28px;}
h3{font-size:.95em;color:#374151;margin-top:16px;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.9em;}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:left;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
tr:hover td{background:#f0f4ff;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
.hl{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.88em;font-family:monospace;}
pre{background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:6px;overflow-x:auto;font-size:.85em;line-height:1.5;}
.badge{color:#fff;padding:2px 8px;border-radius:10px;font-size:.82em;}
ul li,ol li{margin:4px 0;}
.win{color:#15803d;font-weight:bold;}
.footer{color:#9ca3af;font-size:.83em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
</style>
</head><body>

<h1>⑦ 풀 최적화 — 구현 계획 보고서</h1>
<p style="color:#6b7280;font-size:.88em;">${now} · YSTOCK 박스권 자동매매 시스템</p>

<div class="section">
<h2>결론: 박스권 탐지 로직 재작성 불필요</h2>
<div class="hl">
<strong>모델 ⑦의 4가지 개선 중 3가지는 FSM(매매 로직)만 수정합니다.</strong><br>
탐지 알고리즘(<code>detect-pro.js</code>, <code>box-range-pro-core.js</code>)은 건드리지 않아도 됩니다.
유일한 탐지 변경은 <code>constants.js</code> 1줄 수정입니다.
</div>
<table>
<tr><th>개선 항목</th><th>수정 파일</th><th>수정 규모</th><th>탐지 변경?</th></tr>
<tr><td>① TF별 재진입 정책 분리</td><td><code>runner-fsm.js</code></td><td>~12줄</td><td>✕ FSM만</td></tr>
<tr><td>② 재진입 횟수 상한 3회</td><td><code>store.js</code> + <code>runner-fsm.js</code></td><td>~20줄</td><td>✕ FSM만</td></tr>
<tr><td>③ dipLow 버퍼 5%</td><td><code>runner-fsm.js</code></td><td><strong>3줄</strong></td><td>✕ FSM만</td></tr>
<tr><td>④ 최소 거절 2회</td><td><code>constants.js</code></td><td><strong>1줄</strong></td><td>○ 탐지 파라미터</td></tr>
</table>
<p>→ 총 수정 코드: <strong>약 36줄</strong> · 기존 아키텍처 유지 · 위험도 낮음</p>
</div>

<div class="section">
<h2>1. TF별 재진입 정책 분리 (~12줄)</h2>
<h3>변경 위치: <code>server/box-range/runner-fsm.js</code></h3>
<pre>// TP 처리 분기 — 현재 코드
function resetBoxAfterTakeProfit(box) {
  patchBoxSync(box.boxId, { state: "idle", ... });
}

// 수정 후 — TF에 따라 분기
function handleTakeProfitByTF(box) {
  const tf = String(box.timeframe ?? "").trim();
  if (tf === "1h") {
    // 1h 박스: TP 후 소멸 (재진입 없음)
    closeTradingBox(box, "tp-no-reentry-1h");
  } else {
    // 4h, 1d 박스: 재진입 허용
    resetBoxAfterTakeProfit(box);
  }
}</pre>
<div class="ok">TP 처리 코드 한 줄: <code>resetBoxAfterTakeProfit(box)</code> → <code>handleTakeProfitByTF(box)</code></div>
</div>

<div class="section">
<h2>2. 재진입 횟수 상한 3회 (~20줄)</h2>
<h3>Step A: <code>server/box-range/store.js</code> — 필드 추가</h3>
<pre>// box 레코드에 reentryCount 필드 추가
// createBoxRecord() 함수에:
reentryCount: 0,   // TP 재진입 누적 횟수</pre>
<h3>Step B: <code>runner-fsm.js</code> — 카운터 관리</h3>
<pre>// resetBoxAfterTakeProfit 수정
function resetBoxAfterTakeProfit(box) {
  const count = (box.reentryCount ?? 0) + 1;
  const MAX_REENTRY = 3;  // ⑤ 개선안

  if (count >= MAX_REENTRY) {
    // 상한 도달 → 소멸
    closeTradingBox(box, "reentry-cap");
    return;
  }
  patchBoxSync(box.boxId, {
    state: "idle",
    reentryCount: count,
    // 나머지 리셋 동일
    lotQty: 0, buyTradeId: null, entryPrice: null,
    buyAtMs: null, breakAtMs: null, dipLow: null,
    armedAtMs: null, midNotifiedAtMs: null,
  });
}</pre>
</div>

<div class="section">
<h2>3. dipLow 버퍼 5% — <strong>단 3줄</strong></h2>
<h3>변경 위치: <code>server/box-range/runner-fsm.js</code></h3>
<pre>// 현재 SL 조건 (runner-fsm.js ~line 180):
if (lastPrice <= box.dipLow) {
  // SL 처리
}

// 수정 후 — 버퍼 적용:
const DIP_BUFFER_FRAC = 0.05;  // 박스 높이의 5%
const boxHeight = box.top - box.bottom;
const slLevel = box.dipLow - boxHeight * DIP_BUFFER_FRAC;
if (lastPrice <= slLevel) {
  // SL 처리 (동일)
}</pre>
<div class="ok">버퍼 상수 <code>DIP_BUFFER_FRAC</code>는 <code>constants.js</code>에 추가 관리 권장</div>
</div>

<div class="section">
<h2>4. 최소 거절 횟수 2회 — <strong>단 1줄</strong></h2>
<h3>변경 위치: <code>server/box-range/constants.js</code></h3>
<pre>// 현재:
export const BOX_RANGE_PRO_MIN_REJECTIONS = 1;

// 수정:
export const BOX_RANGE_PRO_MIN_REJECTIONS = 2;  // ⑦ 풀 최적화</pre>
<div class="warn">
<strong>주의:</strong> 이 변경 후 30분 스캔 재실행 시 카탈로그가 재구성됩니다.<br>
기존 진행 중인 매매 프로그램에 연결된 박스는 영향 없음 (런타임 박스는 별도 store).<br>
→ 서비스 중단 없이 배포 가능
</div>
</div>

<div class="section">
<h2>구현 순서 (권장)</h2>
<table>
<tr><th>#</th><th>작업</th><th>소요 시간</th><th>리스크</th></tr>
<tr><td>1</td><td>dipLow 버퍼 5% (3줄)</td><td>30분</td><td>낮음 — SL 타이밍 소폭 변화</td></tr>
<tr><td>2</td><td>최소 거절 2회 (1줄)</td><td>10분 + 재스캔</td><td>낮음 — 박스 수 감소</td></tr>
<tr><td>3</td><td>TF별 재진입 분리 (12줄)</td><td>1시간</td><td>중간 — 1h 박스 재진입 중단</td></tr>
<tr><td>4</td><td>재진입 상한 3회 (20줄)</td><td>2시간</td><td>중간 — store 스키마 변경</td></tr>
</table>
<div class="hl">
<strong>총 예상 구현 시간: 약 4시간</strong><br>
테스트: <code>node --test server/box-range/runner-fsm.test.js</code> 기존 테스트 통과 확인
</div>
</div>

<div class="footer">
YSTOCK 박스권 구현 계획 · ${now}<br>
결론: 현행 유지 + 점진적 개선(4단계) 권고 — 전면 재작성 불필요
</div>
</body></html>`;
  return { subject, html, text: `[YSTOCK] ⑦ 풀 최적화 구현 계획 — 재작성 불필요\n\n총 수정 ~36줄, 4시간 내 구현 가능.\n1. dipLow 버퍼 5% (3줄)\n2. 최소 거절 2회 (1줄)\n3. TF별 재진입 분리 (12줄)\n4. 재진입 상한 3회 (20줄)\n\n— ${now}` };
}

// ══════════════════════════════════════════════════════════════════════
// 이메일 2: 실제 백테스팅 결과
// ══════════════════════════════════════════════════════════════════════
const CSS2 = `
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.65;color:#111;max-width:1100px;margin:0 auto;padding:24px 16px;background:#f8fafc;}
h1{font-size:1.2em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:24px;}
h3{color:#374151;margin-top:16px;font-size:.95em;}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:.84em;}
th{background:#1e40af;color:#fff;padding:7px 9px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:6px 9px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;}
td.L{text-align:left;font-weight:500;}
tr:hover td{background:#f0f4ff;}
.win{color:#15803d;font-weight:bold;}
.loss{color:#b91c1c;font-weight:bold;}
.dim{color:#9ca3af;}
.best{background:#fef9c3;font-weight:bold;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.hl{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
code{background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:.87em;font-family:monospace;}
ul li{margin:3px 0;}
.footer{color:#9ca3af;font-size:.83em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
`;

function modelBadge(r) {
  return `<span style="background:${r.badge};color:#fff;padding:1px 6px;border-radius:8px;font-size:.8em;">${r.label}</span>`;
}

function buildBacktestEmail(allResults, now) {
  const subject = `[YSTOCK] 실제 백테스팅 결과 — BTC·ETH·SOL·S&P500 (${now})`;

  // 전체 집계
  const aggregate = {};
  for (const sym of allResults) {
    if (!sym.results?.length) continue;
    for (const r of sym.results) {
      if (!aggregate[r.modelId]) {
        aggregate[r.modelId] = { label: r.label, badge: r.badge, total: 0, wins: 0, losses: 0, pnlSum: 0, boxes: 0 };
      }
      const a = aggregate[r.modelId];
      a.total += r.total; a.wins += r.wins; a.losses += r.losses;
      a.pnlSum += r.totalPnl; a.boxes += r.boxes;
    }
  }

  const aggRows = Object.values(aggregate).map(a => {
    const wr = a.total > 0 ? a.wins / a.total * 100 : 0;
    const avgPnl = a.total > 0 ? a.pnlSum / a.total : 0;
    return { ...a, winRate: wr, avgPnl, expectancy: avgPnl };
  });

  // 전체 집계 테이블
  const aggTable = aggRows.map((r, idx) => {
    const isBest = aggRows.every(o => o.avgPnl <= r.avgPnl + 0.001);
    return `<tr class="${isBest ? 'best' : ''}">
  <td class="L">${modelBadge(r)}</td>
  <td>${r.boxes}</td>
  <td>${r.total}</td>
  <td class="${r.winRate >= 60 ? 'win' : r.winRate >= 50 ? '' : 'loss'}">${fmt(r.winRate)}%</td>
  <td class="${r.avgPnl >= 0 ? 'win' : 'loss'}">${fmtP(r.avgPnl)}</td>
  <td class="${r.pnlSum >= 0 ? 'win' : 'loss'}">${fmtP(r.pnlSum, 1)}</td>
</tr>`;
  }).join("\n");

  // 심볼별 상세 섹션
  const symSections = allResults.map(sym => {
    if (!sym.results?.length) {
      return `<div class="section"><h3>${sym.symbol} ${sym.timeframe} <span class="dim">(${sym.error || "오류"})</span></h3></div>`;
    }
    const rows = sym.results.map(r => {
      const isB = sym.results.every(o => o.expectancy <= r.expectancy + 0.001);
      return `<tr class="${isB ? 'best' : ''}">
  <td class="L">${modelBadge(r)}</td>
  <td>${r.boxes}</td>
  <td>${r.total} (T${r.triggered}/E${r.entered})</td>
  <td class="${r.winRate >= 60 ? 'win' : r.winRate >= 50 ? '' : 'loss'}">${fmt(r.winRate)}%</td>
  <td>${fmtP(r.avgTP)}</td>
  <td class="${r.avgSL >= 0 ? '' : 'loss'}">${fmtP(r.avgSL)}</td>
  <td class="${r.expectancy >= 0 ? 'win' : 'loss'}">${fmtP(r.expectancy)}</td>
  <td class="${r.totalPnl >= 0 ? 'win' : 'loss'}">${fmtP(r.totalPnl, 1)}</td>
</tr>`;
    }).join("\n");
    return `<div class="section">
<h3>${sym.symbol} · ${sym.timeframe} · ${sym.candles}봉 · 탐지 ${sym.boxes}박스</h3>
<table>
<tr><th class="L">모델</th><th>박스</th><th>거래(T/E)</th><th>승률</th><th>avgTP</th><th>avgSL</th><th>기대수익</th><th>누적</th></tr>
${rows}
</table>
</div>`;
  }).join("\n");

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title><style>${CSS2}</style></head><body>
<h1>📊 실제 가격 데이터 백테스팅 결과</h1>
<p style="color:#6b7280;font-size:.87em;">${now} · BTC·ETH·SOL + S&P500 대표 5종목 × 1h·1d</p>

<div class="section">
<h2>전체 집계 (모든 심볼·TF 합산)</h2>
<div class="hl">실제 가격 데이터 기반 워크포워드 시뮬레이션 — 박스 탐지 후 이후 캔들에서 각 모델 FSM 실행</div>
<table>
<tr><th class="L">모델</th><th>탐지박스</th><th>거래수</th><th>승률</th><th>거래당 기대수익</th><th>누적 수익</th></tr>
${aggTable}
</table>
<p class="dim" style="font-size:.83em;">※ T=트리거됨, E=진입됨. 트리거 없는 박스(가격이 하단 미이탈)는 거래 미발생.</p>
</div>

<h2>심볼별 상세</h2>
${symSections}

<div class="section">
<h2>결과 해석</h2>
<div class="warn">
<strong>백테스팅 주의사항:</strong>
<ul>
<li>현재 탐지된 박스를 기준으로 역사적 가격에서 FSM 시뮬 (look-ahead bias 일부 포함 가능)</li>
<li>Legacy(①)는 고가·저가 범위 박스에 mid 매수 시뮬 — 같은 봉에서 mid 통과 시 즉시 진입 가정</li>
<li>수수료·슬리피지 미반영 · 실제 체결가 차이 가능</li>
<li>모델 ⑦ 최소거절2회는 탐지 수 변경 없음 (constants.js 미수정 상태) — 동일 박스로 시뮬</li>
</ul>
</div>
</div>

<div class="footer">
YSTOCK 박스권 자동매매 시스템 · 실제 백테스팅 · ${now}<br>
데이터: Binance USDT (BTC·ETH·SOL) · Yahoo Finance (US 주식)
</div>
</body></html>`;

  const text = `[YSTOCK] 실제 백테스팅 결과 (${now})\n\n전체 집계:\n${aggRows.map(r => `${r.label}: 승률 ${fmt(r.winRate)}%, 기대 ${fmtP(r.avgPnl)}`).join("\n")}\n\n— ${now}`;
  return { subject, html, text };
}

// ══════════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════════
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

// 이메일 1: 구현 계획 (즉시 전송)
console.log("\n[1/2] 구현 계획 이메일 생성...");
const planEmail = buildImplPlanEmail(now);
if (!dryRun) {
  if (!isEmailSendingConfigured()) { console.error("SMTP 미설정"); process.exit(1); }
  await sendTransactionalEmail({ to, subject: planEmail.subject, text: planEmail.text, html: planEmail.html });
  console.log(`✓ 구현 계획 이메일 전송 → ${to}`);
} else {
  console.log(`[dry-run] ${planEmail.subject}`);
}

// 실제 백테스팅 대상
const TARGETS = [
  { symbol: "BTC-USDT", isCrypto: true,  tfs: ["1h", "1d"] },
  { symbol: "ETH-USDT", isCrypto: true,  tfs: ["1h", "1d"] },
  { symbol: "SOL-USDT", isCrypto: true,  tfs: ["1h", "1d"] },
  { symbol: "AAPL",     isCrypto: false, tfs: ["1h", "1d"] },
  { symbol: "NVDA",     isCrypto: false, tfs: ["1h", "1d"] },
  { symbol: "MSFT",     isCrypto: false, tfs: ["1h", "1d"] },
  { symbol: "AMZN",     isCrypto: false, tfs: ["1h", "1d"] },
  { symbol: "GOOGL",    isCrypto: false, tfs: ["1h", "1d"] },
];

console.log("\n[2/2] 실제 백테스팅 데이터 수집 중...");
const allResults = [];

for (const target of TARGETS) {
  for (const tf of target.tfs) {
    process.stdout.write(`  ${target.symbol} ${tf}... `);
    const r = await backtestSymbol(target.symbol, tf, target.isCrypto);
    allResults.push(r);
    if (r.error) {
      console.log(`오류: ${r.error}`);
    } else {
      const best = r.results.reduce((b, m) => m.expectancy > b.expectancy ? m : b, r.results[0]);
      console.log(`OK (${r.boxes}박스, 최고: ${best?.label} ${fmtP(best?.expectancy)})`);
    }
    await new Promise(res => setTimeout(res, 800)); // rate limit
  }
}

const btEmail = buildBacktestEmail(allResults, now);
if (!dryRun) {
  await sendTransactionalEmail({ to, subject: btEmail.subject, text: btEmail.text, html: btEmail.html });
  console.log(`\n✓ 백테스팅 결과 이메일 전송 → ${to}`);
} else {
  console.log(`\n[dry-run] ${btEmail.subject}`);
  // 결과 미리보기
  const agg = {};
  for (const s of allResults) {
    if (!s.results?.length) continue;
    for (const r of s.results) {
      if (!agg[r.modelId]) agg[r.modelId] = { label: r.label, total: 0, pnlSum: 0, wins: 0 };
      agg[r.modelId].total += r.total;
      agg[r.modelId].pnlSum += r.totalPnl;
      agg[r.modelId].wins += r.wins;
    }
  }
  console.log("\n── 집계 미리보기 ──");
  for (const a of Object.values(agg)) {
    const wr = a.total > 0 ? (a.wins/a.total*100).toFixed(1) : "0";
    const avg = a.total > 0 ? (a.pnlSum/a.total).toFixed(3) : "0";
    console.log(`  ${a.label}: 거래${a.total} 승률${wr}% 기대${avg}%`);
  }
}
console.log("\n완료.");
