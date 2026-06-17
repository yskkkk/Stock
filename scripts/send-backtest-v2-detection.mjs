#!/usr/bin/env node
/**
 * 탐지 V1 vs V2 — 전 모델 수익률 비교 백테스팅 → 이메일
 * node scripts/send-backtest-v2-detection.mjs
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { fetchBinanceUsdtChart } from "../server/binance-usdt.js";
import { loadStock } from "../server/stock-data.js";
import { detectBoxRangeProAt } from "../server/box-range/detect-pro.js";
import { detectBoxV2At, V2_ER_THRESHOLD } from "../server/box-range/box-range-v2-core.js";
import { BOX_RANGE_MIN_BARS } from "../server/box-range/constants.js";

loadEnvFile();

const TO  = "samron3797@gmail.com";
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

const fmt  = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const fmtS = (n, d = 2) => (Number.isFinite(n) ? (n >= 0 ? `+${fmt(n,d)}` : fmt(n,d)) : "—");
const fmtP = (n, d = 2) => `${fmtS(n, d)}%`;

// ══════════════════════════════════════════════════════════════════════
// FSM 시뮬레이터 (PRO v2 로직 기준)
// ══════════════════════════════════════════════════════════════════════
function simulateFSM(candles, startI, box, model) {
  const { top, bottom, mid } = box;
  const { trigger, slBuffer, maxReentry } = model;

  const trades = [];
  let state = "idle";
  let dipLow = NaN, entryPrice = NaN, reentryCount = 0;
  let triggered = false, entered = false;

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    if (state === "idle") {
      if (trigger === "mid") {
        if (c.low <= mid && c.high >= mid) {
          state = "position"; entryPrice = mid; triggered = true; entered = true;
        }
      } else {
        if (c.low <= bottom) { state = "armed"; dipLow = c.low; triggered = true; }
      }
    } else if (state === "armed") {
      if (c.low < dipLow) dipLow = c.low;
      if (c.close >= bottom) {
        if (maxReentry !== Infinity && reentryCount >= maxReentry) { state = "dead"; break; }
        state = "position"; entryPrice = bottom; reentryCount++; entered = true;
      }
    } else if (state === "position") {
      const slLevel = trigger === "mid" ? bottom : dipLow * (1 - slBuffer);
      if (c.high >= top) {
        const pnl = ((top - entryPrice) / entryPrice) * 100;
        trades.push({ type: "TP", pnl });
        if (maxReentry === 0) { state = "dead"; break; }
        state = "idle"; dipLow = NaN; entryPrice = NaN;
      } else if (Number.isFinite(slLevel) && c.low <= slLevel) {
        const pnl = ((slLevel - entryPrice) / entryPrice) * 100;
        trades.push({ type: "SL", pnl });
        state = "dead"; break;
      }
    } else break;
  }
  return { trades, triggered, entered };
}

// ══════════════════════════════════════════════════════════════════════
// 박스 히스토리 추출 — walk-forward (detectFn 파라미터화)
// ══════════════════════════════════════════════════════════════════════
function extractHistoricalBoxes(candles, timeframe, detectFn) {
  const boxes = [];
  const seen  = new Set();
  const step  = timeframe === "1h" ? 3 : 1;

  for (let i = BOX_RANGE_MIN_BARS + 10; i < candles.length - 2; i += step) {
    const result = detectFn(candles, i, timeframe);
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
// 모델 정의
// ══════════════════════════════════════════════════════════════════════
const MODELS = [
  { id: 1, label: "① Legacy",         trigger: "mid",    slBuffer: 0,    maxReentry: 0,        badge: "#78716c" },
  { id: 2, label: "② 재진입↑",        trigger: "bottom", slBuffer: 0,    maxReentry: Infinity, badge: "#2563eb" },
  { id: 3, label: "③ 재진입✕",        trigger: "bottom", slBuffer: 0,    maxReentry: 0,        badge: "#7c3aed" },
  { id: 4, label: "④ TF분리",         trigger: "bottom", slBuffer: 0,    maxReentry: null,     badge: "#0891b2" },
  { id: 5, label: "⑤ TF분리+상한3",   trigger: "bottom", slBuffer: 0,    maxReentry: null,     badge: "#059669" },
  { id: 6, label: "⑥ +dipLow버퍼",    trigger: "bottom", slBuffer: 0.05, maxReentry: null,     badge: "#d97706" },
  { id: 7, label: "⑦ 풀 최적화",      trigger: "bottom", slBuffer: 0.05, maxReentry: null,     badge: "#dc2626" },
];

function modelForTF(m, tf) {
  if (m.maxReentry !== null) return m;
  const cap = m.id >= 5 ? 3 : Infinity;
  return { ...m, maxReentry: tf === "1h" ? 0 : cap };
}

// ══════════════════════════════════════════════════════════════════════
// 심볼별 백테스팅 (V1 + V2 동시 실행)
// ══════════════════════════════════════════════════════════════════════
async function backtestSymbol(symbol, timeframe, isCrypto) {
  let chartData;
  try {
    chartData = isCrypto
      ? await fetchBinanceUsdtChart(symbol, timeframe)
      : await loadStock(symbol, timeframe);
  } catch (e) {
    return { symbol, timeframe, error: e.message };
  }

  const candles = chartData.candles ?? [];
  if (candles.length < BOX_RANGE_MIN_BARS + 20) {
    return { symbol, timeframe, error: "캔들 부족" };
  }

  const runModels = (boxes) => MODELS.map(modelDef => {
    const m = modelForTF(modelDef, timeframe);
    let trades = [], triggered = 0, entered = 0;

    for (const { box, endIdx } of boxes) {
      const startI = Math.min(endIdx + 1, candles.length - 1);
      const sim = simulateFSM(candles, startI, box, m);
      trades.push(...sim.trades);
      if (sim.triggered) triggered++;
      if (sim.entered)   entered++;
    }

    const wins   = trades.filter(t => t.type === "TP").length;
    const losses = trades.filter(t => t.type === "SL").length;
    const total  = trades.length;
    const winRate    = total > 0 ? wins / total * 100 : 0;
    const avgTP      = wins   > 0 ? trades.filter(t=>t.type==="TP").reduce((s,t)=>s+t.pnl,0)/wins   : 0;
    const avgSL      = losses > 0 ? trades.filter(t=>t.type==="SL").reduce((s,t)=>s+t.pnl,0)/losses : 0;
    const expectancy = winRate/100*avgTP + (1-winRate/100)*avgSL;
    const totalPnl   = trades.reduce((s,t)=>s+t.pnl, 0);

    return {
      modelId: modelDef.id, label: modelDef.label, badge: modelDef.badge,
      boxes: boxes.length, triggered, entered, total, wins, losses,
      winRate, avgTP, avgSL, expectancy, totalPnl,
    };
  });

  const boxesV1 = extractHistoricalBoxes(candles, timeframe, detectBoxRangeProAt);
  const boxesV2 = extractHistoricalBoxes(candles, timeframe, detectBoxV2At);

  return {
    symbol, timeframe,
    candles: candles.length,
    v1: { boxes: boxesV1.length, results: runModels(boxesV1) },
    v2: { boxes: boxesV2.length, results: runModels(boxesV2) },
  };
}

// ══════════════════════════════════════════════════════════════════════
// 집계 헬퍼
// ══════════════════════════════════════════════════════════════════════
function aggregateResults(allResults, version) {
  const agg = {};
  for (const sym of allResults) {
    if (!sym[version]?.results?.length) continue;
    for (const r of sym[version].results) {
      if (!agg[r.modelId]) agg[r.modelId] = { label: r.label, badge: r.badge, total: 0, wins: 0, losses: 0, pnlSum: 0, boxes: 0 };
      const a = agg[r.modelId];
      a.total += r.total; a.wins += r.wins; a.losses += r.losses;
      a.pnlSum += r.totalPnl; a.boxes += r.boxes;
    }
  }
  return Object.values(agg).map(a => {
    const wr = a.total > 0 ? a.wins / a.total * 100 : 0;
    const avg = a.total > 0 ? a.pnlSum / a.total : 0;
    return { ...a, winRate: wr, avgPnl: avg };
  });
}

// ══════════════════════════════════════════════════════════════════════
// 이메일 빌더
// ══════════════════════════════════════════════════════════════════════
const CSS = `
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:1100px;margin:0 auto;padding:26px 16px;background:#f8fafc;}
h1{font-size:1.22em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:26px;}
h3{font-size:.95em;color:#374151;margin:14px 0 6px;}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:.85em;}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;}
td.L{text-align:left;font-weight:500;}
tr:hover td{background:#f0f4ff;}
.win{color:#15803d;font-weight:bold;}
.loss{color:#b91c1c;font-weight:bold;}
.dim{color:#9ca3af;font-size:.88em;}
.best{background:#fef9c3;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:9px;padding:18px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.05);}
.ok  {background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
.hl  {background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.87em;font-family:monospace;}
.v1{background:#e0f2fe;color:#0369a1;padding:1px 7px;border-radius:6px;font-size:.82em;font-weight:bold;}
.v2{background:#dcfce7;color:#15803d;padding:1px 7px;border-radius:6px;font-size:.82em;font-weight:bold;}
.diff-up{color:#15803d;font-weight:bold;}
.diff-dn{color:#b91c1c;font-weight:bold;}
ul li{margin:4px 0;}
.footer{color:#9ca3af;font-size:.82em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
`;

function badge(r) {
  return `<span style="background:${r.badge};color:#fff;padding:1px 7px;border-radius:8px;font-size:.8em;">${r.label}</span>`;
}

function aggTable(rows, title, cls) {
  const best = rows.reduce((b, r) => r.avgPnl > b.avgPnl ? r : b, rows[0] ?? { avgPnl: -Infinity });
  const rowsHtml = rows.map(r => {
    const isBest = r.avgPnl >= best.avgPnl - 0.001;
    return `<tr class="${isBest?'best':''}">
  <td class="L">${badge(r)}</td>
  <td>${r.boxes}</td><td>${r.total}</td>
  <td class="${r.winRate>=60?'win':r.winRate>=50?'':'loss'}">${fmt(r.winRate)}%</td>
  <td class="${r.avgPnl>=0?'win':'loss'}">${fmtP(r.avgPnl)}</td>
  <td class="${r.pnlSum>=0?'win':'loss'}">${fmtP(r.pnlSum,1)}</td>
</tr>`;
  }).join("");
  return `
<h3><span class="${cls}">${title}</span></h3>
<table>
<tr><th class="L">모델</th><th>탐지박스</th><th>거래수</th><th>승률</th><th>기대수익/거래</th><th>누적수익</th></tr>
${rowsHtml}
</table>`;
}

function buildEmail(allResults) {
  const subject = `[YSTOCK] 탐지 V1 vs V2 — 전 모델 백테스팅 비교 (${now})`;

  const aggV1 = aggregateResults(allResults, "v1");
  const aggV2 = aggregateResults(allResults, "v2");

  // V1 vs V2 비교 요약 테이블
  const compareRows = aggV1.map((r1, idx) => {
    const r2 = aggV2[idx];
    if (!r2) return "";
    const diff = r2 ? r2.avgPnl - r1.avgPnl : 0;
    const boxChg = r2 ? ((r2.boxes - r1.boxes) / Math.max(r1.boxes, 1) * 100) : 0;
    const wrChg  = r2 ? r2.winRate - r1.winRate : 0;
    return `<tr>
  <td class="L">${badge(r1)}</td>
  <td>${r1.boxes} → ${r2?.boxes??'—'} <span class="${boxChg<0?'diff-dn':'diff-up'}">(${boxChg>=0?'+':''}${fmt(boxChg,0)}%)</span></td>
  <td>${fmt(r1.winRate)}% → ${fmt(r2?.winRate)}% <span class="${wrChg>=0?'diff-up':'diff-dn'}">(${wrChg>=0?'+':''}${fmt(wrChg,1)}pp)</span></td>
  <td>${fmtP(r1.avgPnl)} → <strong>${fmtP(r2?.avgPnl)}</strong> <span class="${diff>=0?'diff-up':'diff-dn'}">(${diff>=0?'+':''}${fmtP(diff)})</span></td>
</tr>`;
  }).join("");

  // 심볼별 상세 섹션
  const symSections = allResults.map(sym => {
    if (sym.error) return `<div class="section"><h3>${sym.symbol} ${sym.timeframe} <span class="dim">(${sym.error})</span></h3></div>`;

    const makeRows = (results) => results.map(r => {
      const isB = results.every(o => o.expectancy <= r.expectancy + 0.001);
      return `<tr class="${isB?'best':''}">
  <td class="L">${badge(r)}</td>
  <td>${r.total}</td>
  <td class="${r.winRate>=60?'win':r.winRate>=50?'':'loss'}">${fmt(r.winRate)}%</td>
  <td class="${r.expectancy>=0?'win':'loss'}">${fmtP(r.expectancy)}</td>
  <td class="${r.totalPnl>=0?'win':'loss'}">${fmtP(r.totalPnl,1)}</td>
</tr>`;
    }).join("");

    return `<div class="section">
<h3>${sym.symbol} · ${sym.timeframe} · ${sym.candles}봉</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">
<div>
<div style="margin-bottom:4px"><span class="v1">V1 탐지 (PRO) · ${sym.v1.boxes}박스</span></div>
<table><tr><th class="L">모델</th><th>거래</th><th>승률</th><th>기대</th><th>누적</th></tr>${makeRows(sym.v1.results)}</table>
</div>
<div>
<div style="margin-bottom:4px"><span class="v2">V2 탐지 (ER+Wick+POC) · ${sym.v2.boxes}박스</span></div>
<table><tr><th class="L">모델</th><th>거래</th><th>승률</th><th>기대</th><th>누적</th></tr>${makeRows(sym.v2.results)}</table>
</div>
</div>
</div>`;
  }).join("");

  // 전체 V1 베스트 vs V2 베스트
  const bestV1 = aggV1.reduce((b, r) => r.avgPnl > b.avgPnl ? r : b, aggV1[0] ?? {avgPnl:-Infinity});
  const bestV2 = aggV2.reduce((b, r) => r.avgPnl > b.avgPnl ? r : b, aggV2[0] ?? {avgPnl:-Infinity});
  const overallDiff = (bestV2.avgPnl ?? 0) - (bestV1.avgPnl ?? 0);

  // V2 총 박스 수 / V1 총 박스 수
  const totalBoxV1 = aggV1.reduce((s,r) => Math.max(s, r.boxes), 0);
  const totalBoxV2 = aggV2.reduce((s,r) => Math.max(s, r.boxes), 0);
  const boxReduction = totalBoxV1 > 0 ? ((totalBoxV1 - totalBoxV2) / totalBoxV1 * 100) : 0;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title><style>${CSS}</style></head><body>

<h1>🔬 탐지 V1 vs V2 — 전 모델 수익률 비교</h1>
<p class="dim">${now} · BTC·ETH·SOL + AAPL·NVDA·MSFT·AMZN·GOOGL × 1h·1d</p>

<div class="section">
<h2>핵심 요약</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0;">
<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;text-align:center;">
<div style="font-size:.85em;color:#6b7280;">박스 수 감소</div>
<div style="font-size:1.6em;font-weight:bold;color:#dc2626;">-${fmt(boxReduction,0)}%</div>
<div class="dim">V1 ${totalBoxV1} → V2 ${totalBoxV2}박스</div>
</div>
<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;text-align:center;">
<div style="font-size:.85em;color:#6b7280;">V1 베스트 기대수익</div>
<div style="font-size:1.6em;font-weight:bold;color:${bestV1.avgPnl>=0?'#15803d':'#dc2626'};">${fmtP(bestV1.avgPnl)}</div>
<div class="dim">${bestV1.label} · 거래당</div>
</div>
<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;text-align:center;">
<div style="font-size:.85em;color:#6b7280;">V2 베스트 기대수익</div>
<div style="font-size:1.6em;font-weight:bold;color:${bestV2.avgPnl>=0?'#15803d':'#dc2626'};">${fmtP(bestV2.avgPnl)}</div>
<div class="dim">${bestV2.label} · 거래당</div>
</div>
</div>
${overallDiff >= 0
  ? `<div class="ok"><strong>V2가 V1보다 ${fmtP(overallDiff)} 개선</strong> — ER 필터로 가짜 박스가 제거되어 남은 박스의 품질이 향상됐습니다.</div>`
  : `<div class="warn"><strong>V2가 V1보다 ${fmtP(Math.abs(overallDiff))} 낮음</strong> — ER 필터가 너무 엄격하거나, 탐지 박스 수 감소로 통계적 유의성이 낮아졌을 가능성이 있습니다.</div>`
}
</div>

<div class="section">
<h2>모델별 V1 vs V2 변화량</h2>
<table>
<tr><th class="L">모델</th><th>박스 수 변화</th><th>승률 변화</th><th>기대수익 변화</th></tr>
${compareRows}
</table>
<p class="dim">※ 박스 수 감소 = ER 필터로 추세 구간 박스 제거 · 기대수익 향상 = 남은 박스 품질 개선 효과</p>
</div>

<div class="section">
<h2>전체 집계 — V1 (PRO 기존 탐지)</h2>
${aggTable(aggV1, "V1 탐지 (88/12 종가 퍼센타일 + VWAP)", "v1")}
</div>

<div class="section">
<h2>전체 집계 — V2 (ER+Wick 퍼센타일+POC 개선 탐지)</h2>
${aggTable(aggV2, "V2 탐지 (ER필터+고저퍼센타일+거래량POC)", "v2")}
<div class="hl" style="margin-top:12px;">
<strong>V2 탐지 파라미터:</strong>
ER 임계값 ${V2_ER_THRESHOLD} · top=고가80% · bottom=저가20% · mid=거래량POC · 거절점수≥0.5
</div>
</div>

<h2>심볼별 상세</h2>
${symSections}

<div class="section">
<h2>해석 가이드</h2>
<ul>
<li><strong>박스 수 감소</strong>가 클수록 V2 필터가 엄격 → 적지만 품질 높은 박스만 남음</li>
<li><strong>승률 상승 + 기대수익 상승</strong>이 동시에 일어나면 V2 탐지가 명확히 개선</li>
<li><strong>기대수익은 개선됐지만 박스가 너무 적으면</strong>: ER 임계값을 0.45~0.50으로 완화 고려</li>
<li><strong>V2가 V1보다 낮은 모델</strong>: 해당 모델은 박스 품질보다 빈도가 중요한 전략일 수 있음</li>
</ul>
<div class="warn">
<strong>백테스팅 한계:</strong> 수수료·슬리피지 미반영 · 같은 박스에서 FSM 순방향 시뮬 (look-ahead bias 일부 포함 가능)
</div>
</div>

<div class="footer">
YSTOCK 박스권 탐지 V1 vs V2 비교 · ${now}<br>
V1: <code>box-range-pro-core.js</code> (88/12 종가 퍼센타일 + VWAP)<br>
V2: <code>box-range-v2-core.js</code> (ER필터 + 80/20 고저 퍼센타일 + 거래량 POC + 거절 강도 스코어)
</div>
</body></html>`;

  const text = `[YSTOCK] 탐지 V1 vs V2 비교 (${now})\n\n박스 수 변화: -${fmt(boxReduction,0)}%\nV1 베스트: ${bestV1.label} ${fmtP(bestV1.avgPnl)}\nV2 베스트: ${bestV2.label} ${fmtP(bestV2.avgPnl)}\n개선폭: ${fmtP(overallDiff)}\n\n— ${now}`;

  return { subject, html, text };
}

// ══════════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════════
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

console.log("탐지 V1 vs V2 백테스팅 시작...\n");
const allResults = [];

for (const target of TARGETS) {
  for (const tf of target.tfs) {
    process.stdout.write(`  ${target.symbol} ${tf}... `);
    const r = await backtestSymbol(target.symbol, tf, target.isCrypto);
    allResults.push(r);
    if (r.error) {
      console.log(`오류: ${r.error}`);
    } else {
      const bV1 = r.v1.boxes, bV2 = r.v2.boxes;
      const bestV2 = r.v2.results.reduce((b, m) => m.expectancy > b.expectancy ? m : b, r.v2.results[0]);
      console.log(`OK  V1:${bV1}박스 → V2:${bV2}박스 (${bV2>0?((bV2-bV1)/bV1*100).toFixed(0):'-'}%) | V2베스트: ${bestV2?.label} ${fmtP(bestV2?.expectancy)}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
}

const email = buildEmail(allResults);

if (!isEmailSendingConfigured()) { console.error("SMTP 미설정"); process.exit(1); }
await sendTransactionalEmail({ to: TO, subject: email.subject, text: email.text, html: email.html });
console.log(`\n✓ 이메일 전송 완료 → ${TO}`);
console.log("완료.");
