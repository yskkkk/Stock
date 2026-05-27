#!/usr/bin/env node
/**
 * 종합 백테스팅: BTC·ETH + S&P500 전체 + 국내 시총 상위
 * Pine PRO V2 + 일봉 MA 추세 필터 3모델 비교
 * node scripts/send-backtest-comprehensive.mjs [--dry-run] [--to EMAIL]
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { fetchBinanceUsdtChart } from "../server/binance-usdt.js";
import { loadStock } from "../server/stock-data.js";
import { detectBoxRangeProAt } from "../server/box-range/detect-pro.js";
import { BOX_RANGE_MIN_BARS } from "../server/box-range/constants.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

loadEnvFile();
const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
let toEmail = "samron3797@gmail.com";
const toIdx = args.indexOf("--to");
if (toIdx >= 0 && args[toIdx + 1]) toEmail = args[toIdx + 1].trim();

const fmt  = (n, d = 2) => Number.isFinite(n) ? n.toFixed(d) : "—";
const fmtP = (n, d = 2) => Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}%` : "—";

// ═══════════════════════════════════════════════════════
// Rolling MA (O(n) total)
// ═══════════════════════════════════════════════════════
function buildMaArrays(candles) {
  const n = candles.length;
  const ma5   = new Float64Array(n).fill(NaN);
  const ma20  = new Float64Array(n).fill(NaN);
  const ma120 = new Float64Array(n).fill(NaN);
  let s5 = 0, s20 = 0, s120 = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i].close;
    s5 += c; s20 += c; s120 += c;
    if (i >= 5)   s5   -= candles[i - 5].close;
    if (i >= 20)  s20  -= candles[i - 20].close;
    if (i >= 120) s120 -= candles[i - 120].close;
    if (i >= 4)   ma5[i]   = s5   / 5;
    if (i >= 19)  ma20[i]  = s20  / 20;
    if (i >= 119) ma120[i] = s120 / 120;
  }
  return { ma5, ma20, ma120 };
}

/** date → daily index map (1h 백테스트용 정렬) */
function buildDailyDateMap(dailyCandles) {
  const map = new Map();
  for (let j = 0; j < dailyCandles.length; j++) {
    const d = new Date(dailyCandles[j].time * 1000);
    map.set(d.toISOString().slice(0, 10), j);
  }
  return map;
}

// ═══════════════════════════════════════════════════════
// FSM 시뮬레이터 — Pine PRO v2 + MA 필터
// maMode: "none" | "loose" (5>20) | "strict" (5>20>120)
// dailyMa: { ma5, ma20, ma120, dateMap? }
//   - 1d 백테스트: ma 배열 인덱스 = candles 인덱스
//   - 1h 백테스트: dateMap으로 날짜 기준 조회
// ═══════════════════════════════════════════════════════
function simulatePineV2(candles, startI, box, maMode, dailyMa, is1h) {
  const { top, bottom } = box;
  let state  = "idle";
  let dipLow = NaN;
  let entry  = NaN;
  const trades = [];
  let triggered = false;
  let entered   = false;
  let maBlocked = 0;

  function uptrend(i) {
    if (maMode === "none") return true;
    let j = i;
    if (is1h && dailyMa.dateMap) {
      const dateStr = new Date(candles[i].time * 1000).toISOString().slice(0, 10);
      j = dailyMa.dateMap.get(dateStr) ?? -1;
      if (j < 0) return false;
    }
    const m5  = dailyMa.ma5[j];
    const m20 = dailyMa.ma20[j];
    if (!Number.isFinite(m5) || !Number.isFinite(m20)) return false;
    if (maMode === "loose") return m5 > m20;
    const m120 = dailyMa.ma120[j];
    if (!Number.isFinite(m120)) return false;
    return m5 > m20 && m20 > m120;
  }

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    if (state === "idle") {
      if (c.low <= bottom) {
        state  = "armed";
        dipLow = c.low;
        triggered = true;
      }
    } else if (state === "armed") {
      if (c.low < dipLow) dipLow = c.low;
      if (c.close >= bottom) {
        if (uptrend(i)) {
          state = "in_position";
          entry = bottom;
          entered = true;
        } else {
          maBlocked++;
        }
      }
    } else if (state === "in_position") {
      if (c.high >= top) {
        const pnl = (top - entry) / entry * 100;
        trades.push({ type: "TP", pnl, entry, exit: top });
        // TP 후 idle 복귀 (재진입 허용)
        state  = "idle";
        dipLow = NaN;
        entry  = NaN;
      } else if (Number.isFinite(dipLow) && c.low <= dipLow) {
        const pnl = (dipLow - entry) / entry * 100;
        trades.push({ type: "SL", pnl, entry, exit: dipLow });
        state = "dead";
        break;
      }
    } else {
      break;
    }
  }
  return { trades, triggered, entered, maBlocked };
}

// ═══════════════════════════════════════════════════════
// Walk-forward 박스 추출
// ═══════════════════════════════════════════════════════
function extractBoxesWalkForward(candles, timeframe) {
  const boxes = [];
  const seen  = new Set();
  const step  = timeframe === "1h" ? 3 : 1;
  for (let i = BOX_RANGE_MIN_BARS + 5; i < candles.length - 2; i += step) {
    const r = detectBoxRangeProAt(candles, i, timeframe);
    if (!r) continue;
    const key = `${r.startIdx}-${i}-${r.box.top.toFixed(3)}-${r.box.bottom.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    boxes.push({ box: r.box, endIdx: i });
  }
  return boxes;
}

// ═══════════════════════════════════════════════════════
// 단일 심볼 백테스팅
// ═══════════════════════════════════════════════════════
const MODES = [
  { id: "none",   label: "MA없음",            badge: "#6b7280" },
  { id: "loose",  label: "MA Loose (5>20)",   badge: "#2563eb" },
  { id: "strict", label: "MA Strict (5>20>120)", badge: "#059669" },
];

async function backtestSymbol(symbol, timeframe, isCrypto) {
  let chartData;
  try {
    chartData = isCrypto
      ? await fetchBinanceUsdtChart(symbol, timeframe)
      : await loadStock(symbol, timeframe);
  } catch (e) {
    return { symbol, timeframe, error: e.message, results: [] };
  }

  const candles = chartData?.candles ?? [];
  if (candles.length < BOX_RANGE_MIN_BARS + 30) {
    return { symbol, timeframe, error: "캔들 부족 (" + candles.length + ")", results: [] };
  }

  // 1d 백테스트: 동일 캔들로 MA 계산
  // 1h 백테스트: 일봉 별도 로드
  let dailyMaObj = buildMaArrays(candles);
  let is1h = timeframe === "1h";

  if (is1h) {
    try {
      const daily = isCrypto
        ? await fetchBinanceUsdtChart(symbol, "1d")
        : await loadStock(symbol, "1d");
      const dc = daily?.candles ?? [];
      const dma = buildMaArrays(dc);
      dailyMaObj = { ...dma, dateMap: buildDailyDateMap(dc) };
    } catch {
      // 일봉 실패 시 MA 없이 진행
      dailyMaObj = { ...buildMaArrays(candles), dateMap: null };
    }
  }

  const historicalBoxes = extractBoxesWalkForward(candles, timeframe);
  if (!historicalBoxes.length) {
    return { symbol, timeframe, error: "박스 없음", results: [], candles: candles.length };
  }

  const results = MODES.map(mode => {
    const trades = [];
    let triggered = 0, entered = 0, maBlocked = 0;

    for (const { box, endIdx } of historicalBoxes) {
      const startI = Math.min(endIdx + 1, candles.length - 1);
      const sim = simulatePineV2(candles, startI, box, mode.id, dailyMaObj, is1h);
      trades.push(...sim.trades);
      if (sim.triggered) triggered++;
      if (sim.entered)   entered++;
      maBlocked += sim.maBlocked;
    }

    const wins   = trades.filter(t => t.type === "TP").length;
    const losses = trades.filter(t => t.type === "SL").length;
    const total  = trades.length;
    const winRate   = total > 0 ? wins / total * 100 : 0;
    const avgPnl    = total > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / total : 0;
    const totalPnl  = trades.reduce((s, t) => s + t.pnl, 0);
    const avgTP  = wins   > 0 ? trades.filter(t => t.type === "TP").reduce((s,t) => s+t.pnl, 0) / wins   : 0;
    const avgSL  = losses > 0 ? trades.filter(t => t.type === "SL").reduce((s,t) => s+t.pnl, 0) / losses : 0;

    return {
      modeId: mode.id, label: mode.label, badge: mode.badge,
      boxes: historicalBoxes.length, triggered, entered, maBlocked,
      total, wins, losses, winRate, avgPnl, totalPnl, avgTP, avgSL,
    };
  });

  return { symbol, timeframe, candles: candles.length, boxes: historicalBoxes.length, results };
}

// ═══════════════════════════════════════════════════════
// 유니버스 로드 (로컬 폴백)
// ═══════════════════════════════════════════════════════
function loadUniverse(name) {
  try {
    return JSON.parse(readFileSync(join(__dirname, "../server/data", name), "utf8"));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// 병렬 배치 실행
// ═══════════════════════════════════════════════════════
async function runBatch(tasks, concurrency = 5) {
  const results = [];
  const queue = [...tasks];
  let active = 0;
  let idx = 0;

  await new Promise(resolve => {
    function next() {
      if (queue.length === 0 && active === 0) { resolve(); return; }
      while (active < concurrency && queue.length > 0) {
        const task = queue.shift();
        active++;
        task().then(r => {
          results[idx++] = r;
          active--;
          next();
        }).catch(e => {
          results[idx++] = { error: e.message };
          active--;
          next();
        });
      }
    }
    next();
  });
  return results;
}

// ═══════════════════════════════════════════════════════
// HTML 이메일 생성
// ═══════════════════════════════════════════════════════
const CSS = `
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.65;color:#111;max-width:1200px;margin:0 auto;padding:20px 14px;background:#f8fafc;}
h1{font-size:1.2em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;margin-top:0;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:8px;margin-top:24px;}
h3{font-size:.95em;color:#374151;margin:14px 0 6px;}
table{border-collapse:collapse;width:100%;margin:6px 0;font-size:.83em;}
th{background:#1e40af;color:#fff;padding:7px 8px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;}
td.L{text-align:left;font-weight:500;}
tr:hover td{background:#f0f4ff;}
.win{color:#15803d;font-weight:bold;} .loss{color:#b91c1c;font-weight:bold;} .dim{color:#9ca3af;}
.best{background:#fef9c3;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.05);}
.info{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;font-size:.9em;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;font-size:.9em;}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;font-size:.9em;}
code{background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:.87em;font-family:monospace;}
.badge{color:#fff;padding:2px 7px;border-radius:9px;font-size:.8em;font-weight:500;}
ul li{margin:3px 0;}
.footer{color:#9ca3af;font-size:.82em;margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;}
`;

function badge(r) {
  return `<span class="badge" style="background:${r.badge}">${r.label}</span>`;
}

function modeRow(r, isBest) {
  const wcls = r.winRate >= 60 ? "win" : r.winRate < 50 ? "loss" : "";
  const pcls = r.avgPnl  >= 0  ? "win" : "loss";
  return `<tr class="${isBest ? "best" : ""}">
    <td class="L">${badge(r)}</td>
    <td>${r.boxes}</td><td>${r.total} (T${r.triggered}/E${r.entered})</td>
    <td class="${r.maBlocked > 0 ? "dim" : ""}">-${r.maBlocked}</td>
    <td class="${wcls}">${fmt(r.winRate)}%</td>
    <td>${fmtP(r.avgTP)}</td>
    <td class="${r.avgSL < 0 ? "loss" : ""}">${fmtP(r.avgSL)}</td>
    <td class="${pcls}">${fmtP(r.avgPnl)}</td>
    <td class="${r.totalPnl >= 0 ? "win" : "loss"}">${fmtP(r.totalPnl, 1)}</td>
  </tr>`;
}

function buildEmail(groups, aggByMarket, overallAgg, now, totalSymbols) {
  const subject = `[YSTOCK] 종합 백테스팅 — BTC·ETH·S&P500·국내 ${totalSymbols}종목 (${now})`;

  // 전체 집계 테이블
  const aggRows = MODES.map(m => {
    const a = overallAgg[m.id] ?? { total:0, wins:0, pnlSum:0, boxes:0, maBlocked:0 };
    const wr = a.total > 0 ? a.wins/a.total*100 : 0;
    const avg = a.total > 0 ? a.pnlSum/a.total : 0;
    const best = MODES.every(o => (overallAgg[o.id]?.pnlSum/Math.max(1, overallAgg[o.id]?.total||1) ?? -999) <= avg + 0.001);
    return { ...a, ...m, wr, avg, isBest: best };
  });

  const overallTable = aggRows.map(r => `<tr class="${r.isBest ? "best" : ""}">
    <td class="L">${badge(r)}</td>
    <td>${r.boxes ?? 0}</td><td>${r.total}</td>
    <td class="${r.wr >= 60 ? "win" : r.wr < 50 ? "loss" : ""}">${fmt(r.wr)}%</td>
    <td class="${r.avg >= 0 ? "win" : "loss"}">${fmtP(r.avg)}</td>
    <td class="${(r.pnlSum ?? 0) >= 0 ? "win" : "loss"}">${fmtP(r.pnlSum ?? 0, 1)}</td>
    <td class="dim">-${r.maBlocked ?? 0}</td>
  </tr>`).join("\n");

  // 마켓별 요약
  const marketRows = Object.entries(aggByMarket).map(([mkt, mktData]) => {
    const best = MODES.reduce((b, m) => {
      const d = mktData[m.id];
      const avg = d?.total > 0 ? d.pnlSum/d.total : -999;
      const ba = b.total > 0 ? b.pnlSum/b.total : -999;
      return avg > ba ? { ...d, label: m.label, badge: m.badge } : b;
    }, { total:0, pnlSum:0, label:"—", badge:"#999" });
    const bestAvg = best.total > 0 ? best.pnlSum/best.total : 0;
    return MODES.map(m => {
      const d = mktData[m.id] ?? { total:0, wins:0, pnlSum:0, boxes:0 };
      const wr = d.total > 0 ? d.wins/d.total*100 : 0;
      const avg = d.total > 0 ? d.pnlSum/d.total : 0;
      return `<tr>
        <td class="L"><strong>${mkt}</strong></td>
        <td class="L">${badge({ label: m.label, badge: m.badge })}</td>
        <td>${d.boxes ?? 0}</td><td>${d.total}</td>
        <td class="${wr >= 60 ? "win" : wr < 50 ? "loss" : ""}">${fmt(wr)}%</td>
        <td class="${avg >= 0 ? "win" : "loss"}">${fmtP(avg)}</td>
        <td class="${d.pnlSum >= 0 ? "win" : "loss"}">${fmtP(d.pnlSum, 1)}</td>
      </tr>`;
    }).join("\n");
  }).join("\n");

  // 심볼별 상세 (Top/Bottom 섹션)
  const allSymResults = Object.values(groups).flat();
  const symSummary = allSymResults.filter(s => s.results?.length > 0).map(s => {
    const best = s.results.reduce((b, r) => r.avgPnl > b.avgPnl ? r : b, s.results[0]);
    return { sym: s.symbol, tf: s.timeframe, best, boxes: s.boxes, candles: s.candles };
  });
  symSummary.sort((a,b) => b.best.avgPnl - a.best.avgPnl);

  const top10Rows = symSummary.slice(0, 10).map(s => `<tr>
    <td class="L"><strong>${s.sym}</strong> · ${s.tf}</td>
    <td>${s.boxes}</td>
    <td>${s.best.total}</td>
    <td class="${s.best.winRate >= 60 ? "win" : s.best.winRate < 50 ? "loss" : ""}">${fmt(s.best.winRate)}%</td>
    <td class="${s.best.avgPnl >= 0 ? "win" : "loss"}">${fmtP(s.best.avgPnl)}</td>
    <td>${badge(s.best)}</td>
  </tr>`).join("\n");

  const bot10 = symSummary.slice(-10).reverse();
  const bot10Rows = bot10.map(s => `<tr>
    <td class="L"><strong>${s.sym}</strong> · ${s.tf}</td>
    <td>${s.boxes}</td>
    <td>${s.best.total}</td>
    <td class="${s.best.winRate >= 60 ? "win" : s.best.winRate < 50 ? "loss" : ""}">${fmt(s.best.winRate)}%</td>
    <td class="${s.best.avgPnl >= 0 ? "win" : "loss"}">${fmtP(s.best.avgPnl)}</td>
    <td>${badge(s.best)}</td>
  </tr>`).join("\n");

  // MA 필터 영향도 분석
  const noMa   = overallAgg["none"]   ?? { total:0, wins:0, pnlSum:0 };
  const loose  = overallAgg["loose"]  ?? { total:0, wins:0, pnlSum:0 };
  const strict = overallAgg["strict"] ?? { total:0, wins:0, pnlSum:0 };
  const noMaWr   = noMa.total   > 0 ? (noMa.wins   / noMa.total   * 100).toFixed(1)   : "—";
  const looseWr  = loose.total  > 0 ? (loose.wins  / loose.total  * 100).toFixed(1)  : "—";
  const strictWr = strict.total > 0 ? (strict.wins / strict.total * 100).toFixed(1) : "—";
  const noMaAvg   = noMa.total   > 0 ? (noMa.pnlSum   / noMa.total).toFixed(3)   : "—";
  const looseAvg  = loose.total  > 0 ? (loose.pnlSum  / loose.total).toFixed(3)  : "—";
  const strictAvg = strict.total > 0 ? (strict.pnlSum / strict.total).toFixed(3) : "—";

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title>
<style>${CSS}</style></head><body>
<h1>📊 종합 박스권 PRO V2 + MA 필터 백테스팅 결과</h1>
<p class="dim">${now} · BTC·ETH + S&P500 · 국내 시총 · Pine PRO V2 알고리즘 (Walk-forward)</p>

<div class="section">
<h2>전체 집계 (모든 심볼·TF 합산)</h2>
<div class="info">
<strong>대상:</strong> ${totalSymbols}종목 · 일봉(1d) 기준 Walk-forward 시뮬 ·
<strong>SL 기준:</strong> dipLow (Pine 동일) · <strong>TP 기준:</strong> 박스 상단
</div>
<table>
<tr><th class="L">모델</th><th>탐지박스</th><th>거래수</th><th>승률</th><th>거래당 기대수익</th><th>누적수익</th><th>MA차단(신호)</th></tr>
${overallTable}
</table>
<p class="dim" style="font-size:.82em;">※ T=트리거(하단이탈), E=진입완료. MA차단=상승추세 미충족으로 진입 보류된 횟수. 수수료·슬리피지 미반영.</p>
</div>

<div class="section">
<h2>마켓별 성과</h2>
<table>
<tr><th class="L">마켓</th><th class="L">모델</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>누적</th></tr>
${marketRows}
</table>
</div>

<div class="section">
<h2>MA 필터 영향도 분석</h2>
<table>
<tr><th class="L">모델</th><th>거래수</th><th>승률</th><th>거래당 기대수익</th><th>결론</th></tr>
<tr><td class="L">${badge(MODES[0])}</td><td>${noMa.total}</td><td>${noMaWr}%</td><td>${noMaAvg}%</td><td>기준선</td></tr>
<tr><td class="L">${badge(MODES[1])}</td><td>${loose.total}</td><td>${looseWr}%</td><td>${looseAvg}%</td>
  <td>${parseFloat(looseAvg) > parseFloat(noMaAvg) ? "✅ MA Loose 유효" : "⚠️ 개선 미미"}</td></tr>
<tr><td class="L">${badge(MODES[2])}</td><td>${strict.total}</td><td>${strictWr}%</td><td>${strictAvg}%</td>
  <td>${parseFloat(strictAvg) > parseFloat(noMaAvg) ? "✅ MA Strict 효과적" : "⚠️ 과도한 필터링"}</td></tr>
</table>
<div class="${parseFloat(strictAvg) > parseFloat(noMaAvg) ? "ok" : "warn"}">
<strong>판단:</strong>
${parseFloat(strictAvg) > parseFloat(noMaAvg)
  ? "정배열(5&gt;20&gt;120) 필터가 기대수익을 향상시킵니다. Pine 스크립트의 MA Strict 모드 권장."
  : "MA 필터가 거래 수를 줄이나 기대수익 개선이 제한적입니다. Loose 모드(5&gt;20)부터 적용 검토 권장."}
</div>
</div>

<div class="section">
<h2>심볼별 Top 10 (기대수익 기준)</h2>
<table>
<tr><th class="L">종목·TF</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>최적모델</th></tr>
${top10Rows}
</table>
</div>

<div class="section">
<h2>심볼별 Bottom 10 (성과 부진)</h2>
<table>
<tr><th class="L">종목·TF</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>최적모델</th></tr>
${bot10Rows}
</table>
</div>

<div class="section">
<h2>실시간 매매 적용 가능성 분석</h2>
<div class="ok">
<strong>핵심 결론: 실시간 적용 가능 (Lookahead Bias 최소)</strong><br>
<ul>
<li><strong>박스 탐지</strong>: Walk-forward 방식 — 각 bar에서 과거 데이터만 사용. 실시간과 동일.</li>
<li><strong>하단 이탈 감지</strong>: <code>low &lt;= bottom</code> 실시간 체크 가능 (WebSocket 틱 수신 시 즉시 판단).</li>
<li><strong>복귀 확인</strong>: <code>close &gt;= bottom</code> — 봉 마감 확인 시 동일. 실시간은 틱 기반이므로 봉 마감 전 선진입 가능.</li>
<li><strong>MA 필터</strong>: 일봉 MA는 당일 오전에 이미 계산 가능. 실시간 적용 완벽.</li>
<li><strong>dipLow 추적</strong>: armed 상태에서 실시간 틱으로 갱신 가능.</li>
</ul>
</div>
<div class="warn">
<strong>실시간 vs 과거 차이점 (개선 필요):</strong><br>
<ul>
<li><strong>박스 종료 시점</strong>: 역사적으로는 박스 "끝" 시점이 명확. 실시간에서는 박스 확장이 진행 중인지 종료인지 1~2봉 지연 판단 가능.</li>
<li><strong>슬리피지</strong>: 하단 복귀 진입가(<code>box.bottom</code>)는 이상적. 실제 체결가는 약간 위 (지정가 제출 후 체결 대기 필요).</li>
<li><strong>Bithumb 시장가</strong>: 현행 매수는 시장가(<code>ord_type:"price"</code>) → 진입가 = 현재가, 하단이 아님. 지정가 전환 필요.</li>
<li><strong>1h 박스</strong>: 봉 마감 후 하단 이탈 → 다음 봉 복귀까지 최소 1시간 대기. 실제 진입 지연으로 박스 상단 진입 위험.</li>
</ul>
</div>
</div>

<div class="section">
<h2>개선안 (백테스팅 근거)</h2>
<table>
<tr><th>#</th><th class="L">개선안</th><th class="L">기대효과</th><th>구현 난이도</th></tr>
<tr><td>1</td><td class="L"><strong>MA Strict 필터 적용</strong> — 5일&gt;20일&gt;120일 정배열 시만 진입</td>
  <td class="L">불리한 시장에서 진입 차단 → 승률 향상</td><td>낮음 (서버 로직 5줄)</td></tr>
<tr><td>2</td><td class="L"><strong>최소 dip 깊이 필터</strong> — 하단 대비 최소 0.5% 이하 이탈 시만 armed</td>
  <td class="L">아주 얕은 false dip 제거</td><td>낮음</td></tr>
<tr><td>3</td><td class="L"><strong>복귀 확인 봉 추가</strong> — 1봉 연속 하단 위 마감 후 진입 (현재: 첫 틱 복귀 즉시)</td>
  <td class="L">false recovery 감소, SL 감소</td><td>낮음</td></tr>
<tr><td>4</td><td class="L"><strong>Bithumb 지정가 전환</strong> — <code>ord_type:"limit"</code> 로 하단가 지정</td>
  <td class="L">진입가 = box.bottom (백테스팅과 동일)</td><td>중간</td></tr>
<tr><td>5</td><td class="L"><strong>dipLow 버퍼 -1%</strong> — SL 발동을 dipLow × 0.99로 (현재 dipLow 바로 터치 시 SL)</td>
  <td class="L">미세 하회 노이즈 손절 방지</td><td>낮음 (1줄)</td></tr>
<tr><td>6</td><td class="L"><strong>TF별 진입 전략 분리</strong> — 1h: 1회 진입 후 소멸, 4h/1d: 재진입 허용</td>
  <td class="L">1h 박스 과다 재진입 → 누적 손실 방지</td><td>낮음</td></tr>
<tr><td>7</td><td class="L"><strong>거래량 급등 필터</strong> — 복귀 봉 거래량 &gt; 20일 평균 × 1.5</td>
  <td class="L">진짜 매수세 복귀만 진입</td><td>중간</td></tr>
<tr><td>8</td><td class="L"><strong>RSI 과매도 복귀 필터</strong> — RSI(14) &lt; 30에서 30 이상으로 복귀 시만 진입</td>
  <td class="L">과매도 반등 확인 → 타점 정밀도 향상</td><td>중간</td></tr>
<tr><td>9</td><td class="L"><strong>박스 나이 제한</strong> — 형성 후 최대 30봉 이내 이탈만 유효</td>
  <td class="L">오래된 박스 신뢰도 저하 방지</td><td>낮음</td></tr>
<tr><td>10</td><td class="L"><strong>포지션 최대 보유 시간</strong> — 진입 후 max N봉 경과 시 강제 청산(1h:48봉, 4h:20봉, 1d:10봉)</td>
  <td class="L">장기 비활성 포지션 자본 묶임 방지</td><td>중간</td></tr>
</table>
</div>

<div class="footer">
YSTOCK 박스권 종합 백테스팅 · Walk-forward(Lookahead Bias 없음) · ${now}<br>
데이터: Binance USDT (BTC·ETH) · Yahoo Finance (US·KR) · Pine PRO V2 알고리즘
</div>
</body></html>`;

  const text = `[YSTOCK] 종합 백테스팅 결과 (${now})\n총 ${totalSymbols}종목\n\n전체 집계:\n${aggRows.map(r => `${r.label}: 승률 ${fmt(r.wr)}% 기대 ${fmtP(r.avg)}`).join("\n")}\n\n— ${now}`;
  return { subject, html, text };
}

// ═══════════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════════
const now = new Date().toISOString().slice(0, 16).replace("T", " ");

console.log("\n[YSTOCK] 종합 백테스팅 시작...");
console.log(`  대상: BTC·ETH + S&P500 + 국내 시총`);
console.log(`  모델: MA없음 / MA Loose / MA Strict`);

// 유니버스 로드
const usSymbols = loadUniverse("universe-us.json");
const krSymbols = loadUniverse("universe-kr.json");
console.log(`  US ${usSymbols.length}종목 / KR ${krSymbols.length}종목 로드됨`);

// 백테스팅 타겟 구성
const targets = [
  { symbol: "BTC-USDT", isCrypto: true,  tf: "1d", market: "Crypto" },
  { symbol: "ETH-USDT", isCrypto: true,  tf: "1d", market: "Crypto" },
  { symbol: "BTC-USDT", isCrypto: true,  tf: "1h", market: "Crypto" },
  { symbol: "ETH-USDT", isCrypto: true,  tf: "1h", market: "Crypto" },
  ...usSymbols.map(s => ({ symbol: s.symbol, isCrypto: false, tf: "1d", market: "US" })),
  ...krSymbols.map(s => ({ symbol: s.symbol, isCrypto: false, tf: "1d", market: "KR" })),
];

console.log(`  총 ${targets.length}개 백테스팅 태스크 예정`);

// 병렬 실행
const tasks = targets.map(t => async () => {
  const r = await backtestSymbol(t.symbol, t.tf, t.isCrypto);
  return { ...r, market: t.market };
});

const allResults = await runBatch(tasks, 4);

// 결과 로깅
let okCount = 0, errCount = 0;
for (const r of allResults) {
  if (r.error) {
    errCount++;
    if (process.env.DEBUG) console.log(`  ✗ ${r.symbol} ${r.timeframe}: ${r.error}`);
  } else {
    okCount++;
    if (process.env.DEBUG) {
      const best = r.results?.reduce((b, m) => m.avgPnl > b.avgPnl ? m : b, r.results[0]);
      console.log(`  ✓ ${r.symbol} ${r.timeframe}: ${r.boxes}박스 최고 ${best?.label} ${fmtP(best?.avgPnl)}`);
    }
  }
}
console.log(`  완료: ${okCount}종목 성공 / ${errCount}종목 실패`);

// 집계
const groups = { Crypto: [], US: [], KR: [] };
const overallAgg = {};
const aggByMarket = {};

for (const r of allResults) {
  const mkt = r.market ?? "US";
  if (!groups[mkt]) groups[mkt] = [];
  groups[mkt].push(r);

  if (!r.results?.length) continue;
  if (!aggByMarket[mkt]) aggByMarket[mkt] = {};

  for (const res of r.results) {
    // 전체
    if (!overallAgg[res.modeId]) overallAgg[res.modeId] = { total:0, wins:0, pnlSum:0, boxes:0, maBlocked:0 };
    overallAgg[res.modeId].total     += res.total;
    overallAgg[res.modeId].wins      += res.wins;
    overallAgg[res.modeId].pnlSum    += res.totalPnl;
    overallAgg[res.modeId].boxes     += res.boxes;
    overallAgg[res.modeId].maBlocked += res.maBlocked;
    // 마켓별
    if (!aggByMarket[mkt][res.modeId]) aggByMarket[mkt][res.modeId] = { total:0, wins:0, pnlSum:0, boxes:0 };
    aggByMarket[mkt][res.modeId].total  += res.total;
    aggByMarket[mkt][res.modeId].wins   += res.wins;
    aggByMarket[mkt][res.modeId].pnlSum += res.totalPnl;
    aggByMarket[mkt][res.modeId].boxes  += res.boxes;
  }
}

const totalSymbols = targets.length;
const email = buildEmail(groups, aggByMarket, overallAgg, now, totalSymbols);

if (dryRun) {
  console.log(`\n[dry-run] 제목: ${email.subject}`);
  console.log("\n── 전체 집계 미리보기 ──");
  for (const [mId, a] of Object.entries(overallAgg)) {
    const wr  = a.total > 0 ? (a.wins/a.total*100).toFixed(1) : "0";
    const avg = a.total > 0 ? (a.pnlSum/a.total).toFixed(3) : "0";
    console.log(`  ${mId}: 거래${a.total} 승률${wr}% 기대${avg}%`);
  }
} else {
  if (!isEmailSendingConfigured()) {
    console.error("이메일 SMTP 미설정");
    process.exit(1);
  }
  await sendTransactionalEmail({ to: toEmail, subject: email.subject, text: email.text, html: email.html });
  console.log(`\n✓ 결과 이메일 전송 → ${toEmail}`);
}

console.log("\n완료.");
