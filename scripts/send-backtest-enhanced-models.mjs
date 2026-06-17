#!/usr/bin/env node
/**
 * 전체 11개 모델 백테스팅 + 모델 점수 산출 → 이메일 + CSV 저장
 *
 * V1 탐지 7개:  ① Legacy ~ ⑦ 풀최적화
 * V2 탐지 4개:  ⑧ 분할익절  ⑨ 거래량필터  ⑩ 확인캔들  ⑪ 전체조합
 *
 * node scripts/send-backtest-enhanced-models.mjs
 */
import fs   from "fs";
import path from "path";
import { loadEnvFile }       from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { fetchBinanceUsdtChart } from "../server/binance-usdt.js";
import { loadStock }             from "../server/stock-data.js";
import { detectBoxRangeProAt }   from "../server/box-range/detect-pro.js";
import { detectBoxV2At }         from "../server/box-range/box-range-v2-core.js";
import { BOX_RANGE_MIN_BARS }    from "../server/box-range/constants.js";

loadEnvFile();

const TO  = "samron3797@gmail.com";
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const fmt  = (n, d=2) => Number.isFinite(n) ? n.toFixed(d) : "—";
const fmtP = (n, d=2) => Number.isFinite(n) ? `${n>=0?"+":""}${n.toFixed(d)}%` : "—";

// ══════════════════════════════════════════════════════════════════════
// FSM — 표준 + 3가지 개선 플래그 통합
// ══════════════════════════════════════════════════════════════════════
function simulateFSM(candles, startI, box, model) {
  const { top, bottom, mid } = box;
  const {
    trigger       = "bottom",
    slBuffer      = 0,
    maxReentry    = Infinity,
    usePartialTP  = false,   // ⑧ mid 도달 시 50% 익절 + SL→손익분기
    useVolFilter  = false,   // ⑨ 이탈봉 거래량 > avgVol×1.5 이면 skip
    useConfirm    = false,   // ⑩ 복귀 다음 봉 추가 확인 후 진입
  } = model;

  // 사전 평균 거래량 (⑨용)
  let avgVol = 0;
  if (useVolFilter) {
    let s = 0, n = 0;
    for (let k = Math.max(0, startI - 20); k < startI; k++) {
      const v = candles[k]?.volume;
      if (Number.isFinite(v) && v > 0) { s += v; n++; }
    }
    avgVol = n > 0 ? s / n : 0;
  }

  const trades = [];
  let state       = "idle";
  let dipLow      = NaN;
  let entryPrice  = NaN;
  let reentryCount = 0;
  let midHit      = false;

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    // ─── idle ───────────────────────────────────────────────────────
    if (state === "idle") {
      if (trigger === "mid") {
        if (c.low <= mid && c.high >= mid) {
          state = "position"; entryPrice = mid;
        }
      } else {
        if (c.low <= bottom) {
          const volOk = !useVolFilter || avgVol <= 0 || c.volume <= avgVol * 1.5;
          if (volOk) { state = "armed"; dipLow = c.low; }
        }
      }

    // ─── armed ──────────────────────────────────────────────────────
    } else if (state === "armed") {
      if (c.low < dipLow) dipLow = c.low;
      if (c.close >= bottom) {
        if (maxReentry !== Infinity && reentryCount >= maxReentry) { state = "dead"; break; }
        if (useConfirm) {
          state = "confirming";           // ⑩: 다음 봉 확인 대기
        } else {
          state = "position"; entryPrice = bottom; reentryCount++; midHit = false;
        }
      }

    // ─── confirming (⑩) ─────────────────────────────────────────────
    } else if (state === "confirming") {
      if (c.low <= bottom) {
        state = "armed";                  // 재이탈 → 다시 armed
        if (c.low < dipLow) dipLow = c.low;
      } else {
        state = "position"; entryPrice = bottom; reentryCount++; midHit = false;
      }

    // ─── position ───────────────────────────────────────────────────
    } else if (state === "position") {
      // ⑧ 분할익절: mid 도달 시 플래그 + SL → 손익분기
      if (usePartialTP && !midHit && c.high >= mid) midHit = true;

      const slLevel = (usePartialTP && midHit)
        ? entryPrice                        // ⑧: 손익분기 SL
        : (trigger === "mid" ? bottom : dipLow * (1 - slBuffer));

      if (c.high >= top) {
        const pnl = ((top - entryPrice) / entryPrice) * 100;
        trades.push({ type: "TP", pnl });
        state = "idle"; dipLow = NaN; entryPrice = NaN; midHit = false;
      } else if (Number.isFinite(slLevel) && c.low <= slLevel) {
        let pnl, type;
        if (usePartialTP && midHit) {
          // mid까지 50% 익절 + 나머지 손익분기 → 소폭 이익
          pnl  = ((mid - entryPrice) / entryPrice) * 100 * 0.5;
          type = "TP_PARTIAL";
        } else {
          pnl  = ((slLevel - entryPrice) / entryPrice) * 100;
          type = "SL";
        }
        trades.push({ type, pnl });
        state = "dead"; break;
      }
    } else break;
  }
  return { trades };
}

// ══════════════════════════════════════════════════════════════════════
// 박스 히스토리 추출 (walk-forward)
// ══════════════════════════════════════════════════════════════════════
function extractBoxes(candles, tf, detectFn) {
  const list = [], seen = new Set();
  const step = tf === "1h" ? 3 : 1;
  for (let i = BOX_RANGE_MIN_BARS + 10; i < candles.length - 2; i += step) {
    const r = detectFn(candles, i, tf);
    if (!r) continue;
    const { box, startIdx } = r;
    const key = `${startIdx}-${i}-${box.top.toFixed(4)}-${box.bottom.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ box, startIdx, endIdx: i });
  }
  return list;
}

// ══════════════════════════════════════════════════════════════════════
// 모델 정의 — 11개
// ══════════════════════════════════════════════════════════════════════
// TF분리 처리: maxReentry=null → tf가 1h이면 0, 4h/1d이면 cap
function resolveModel(m, tf) {
  if (m.maxReentry !== null) return m;
  const cap = m.id >= 5 ? 3 : Infinity;
  return { ...m, maxReentry: tf === "1h" ? 0 : cap };
}

const MODELS_V1 = [
  { id:1, label:"① Legacy",         grp:"V1",  detect:"v1", trigger:"mid",    slBuffer:0,    maxReentry:0,    badge:"#78716c", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:2, label:"② PRO v2 재진입↑", grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0,    maxReentry:Infinity, badge:"#2563eb", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:3, label:"③ PRO v2 재진입✕", grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0,    maxReentry:0,    badge:"#7c3aed", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:4, label:"④ TF분리",          grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0,    maxReentry:null, badge:"#0891b2", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:5, label:"⑤ TF분리+상한3",    grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0,    maxReentry:null, badge:"#059669", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:6, label:"⑥ +dipLow버퍼",     grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#d97706", usePartialTP:false, useVolFilter:false, useConfirm:false },
  { id:7, label:"⑦ 풀최적화(V1)",    grp:"V1",  detect:"v1", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#dc2626", usePartialTP:false, useVolFilter:false, useConfirm:false },
];

const MODELS_V2 = [
  { id:8,  label:"⑧ V2+분할익절",    grp:"V2+", detect:"v2", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#7c3aed", usePartialTP:true,  useVolFilter:false, useConfirm:false },
  { id:9,  label:"⑨ V2+거래량필터",  grp:"V2+", detect:"v2", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#0891b2", usePartialTP:false, useVolFilter:true,  useConfirm:false },
  { id:10, label:"⑩ V2+확인캔들",    grp:"V2+", detect:"v2", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#059669", usePartialTP:false, useVolFilter:false, useConfirm:true  },
  { id:11, label:"⑪ V2+전체조합",    grp:"V2+", detect:"v2", trigger:"bottom", slBuffer:0.05, maxReentry:null, badge:"#b45309", usePartialTP:true,  useVolFilter:true,  useConfirm:true  },
];

const ALL_MODELS = [...MODELS_V1, ...MODELS_V2];

// ══════════════════════════════════════════════════════════════════════
// 심볼 백테스팅
// ══════════════════════════════════════════════════════════════════════
async function backtestSymbol(symbol, tf, isCrypto) {
  let chartData;
  try {
    chartData = isCrypto ? await fetchBinanceUsdtChart(symbol, tf) : await loadStock(symbol, tf);
  } catch(e) { return { symbol, tf, error: e.message, rows: [] }; }

  const candles = chartData.candles ?? [];
  if (candles.length < BOX_RANGE_MIN_BARS + 20) return { symbol, tf, error:"캔들 부족", rows:[] };

  const boxesV1 = extractBoxes(candles, tf, detectBoxRangeProAt);
  const boxesV2 = extractBoxes(candles, tf, detectBoxV2At);

  const rows = ALL_MODELS.map(mDef => {
    const boxes  = mDef.detect === "v1" ? boxesV1 : boxesV2;
    const mResolved = resolveModel(mDef, tf);
    let allTrades = [];

    for (const { box, endIdx } of boxes) {
      const s = simulateFSM(candles, Math.min(endIdx + 1, candles.length - 1), box, mResolved);
      allTrades.push(...s.trades);
    }

    const wins    = allTrades.filter(t => t.type === "TP" || t.type === "TP_PARTIAL").length;
    const losses  = allTrades.filter(t => t.type === "SL").length;
    const total   = allTrades.length;
    const winRate = total > 0 ? wins / total * 100 : 0;
    const pnlArr  = allTrades.map(t => t.pnl);
    const totalPnl= pnlArr.reduce((s,v)=>s+v, 0);
    const avgPnl  = total > 0 ? totalPnl / total : 0;
    const winPnl  = allTrades.filter(t=>t.type==="TP"||t.type==="TP_PARTIAL").reduce((s,t)=>s+t.pnl,0);
    const lossPnl = allTrades.filter(t=>t.type==="SL").reduce((s,t)=>s+t.pnl,0);
    const pf      = lossPnl < 0 ? winPnl / Math.abs(lossPnl) : (winPnl > 0 ? 99 : 1);
    const freq    = boxes.length > 0 ? total / boxes.length : 0;
    const partials= allTrades.filter(t=>t.type==="TP_PARTIAL").length;

    return {
      modelId: mDef.id, label: mDef.label, grp: mDef.grp, badge: mDef.badge,
      symbol, tf, boxes: boxes.length, total, wins, losses, partials,
      winRate, avgPnl, totalPnl, profitFactor: pf, tradeFreq: freq,
    };
  });

  return { symbol, tf, candleCount: candles.length, boxV1: boxesV1.length, boxV2: boxesV2.length, rows };
}

// ══════════════════════════════════════════════════════════════════════
// 점수 산출 (0~100점)
// ══════════════════════════════════════════════════════════════════════
function scoreModel(r) {
  // 기대수익: 0%→0pts, 2.5%→100pts
  const expScore = Math.min(100, Math.max(0, r.avgPnl / 2.5 * 100));
  // 승률: 30%→0pts, 70%→100pts
  const wrScore  = Math.min(100, Math.max(0, (r.winRate - 30) / 40 * 100));
  // 수익팩터: 1.0→0pts, 4.0→100pts
  const pfScore  = Math.min(100, Math.max(0, (r.profitFactor - 1) / 3 * 100));
  // 진입빈도: 0→0pts, 1.5→100pts (기회 많을수록 좋음)
  const freqScore= Math.min(100, Math.max(0, r.tradeFreq / 1.5 * 100));

  const total = expScore*0.40 + wrScore*0.25 + pfScore*0.20 + freqScore*0.15;
  return { total: Math.round(total), expScore, wrScore, pfScore, freqScore };
}

function scoreGrade(s) {
  if (s >= 80) return { grade:"S", label:"탁월", color:"#15803d" };
  if (s >= 65) return { grade:"A", label:"우수", color:"#2563eb" };
  if (s >= 50) return { grade:"B", label:"양호", color:"#d97706" };
  if (s >= 35) return { grade:"C", label:"보통", color:"#9ca3af" };
  return        { grade:"D", label:"미흡", color:"#dc2626" };
}

// ══════════════════════════════════════════════════════════════════════
// 전체 집계 + 점수
// ══════════════════════════════════════════════════════════════════════
function aggregateAll(allSymResults) {
  const agg = {};
  for (const sym of allSymResults) {
    if (!sym.rows?.length) continue;
    for (const r of sym.rows) {
      if (!agg[r.modelId]) agg[r.modelId] = {
        modelId: r.modelId, label: r.label, grp: r.grp, badge: r.badge,
        total:0, wins:0, losses:0, partials:0, pnlSum:0, pfWinSum:0, pfLossSum:0, boxes:0, freqSum:0, symCount:0,
      };
      const a = agg[r.modelId];
      a.total    += r.total;    a.wins    += r.wins;    a.losses  += r.losses;
      a.partials += r.partials; a.pnlSum  += r.totalPnl;
      a.pfWinSum += r.wins > 0 ? r.avgPnl * r.wins : 0;
      a.pfLossSum+= r.losses > 0 ? Math.abs(r.avgPnl * r.losses) : 0;
      a.boxes    += r.boxes;    a.freqSum += r.tradeFreq; a.symCount++;
    }
  }
  return Object.values(agg).map(a => {
    const winRate  = a.total > 0 ? a.wins / a.total * 100 : 0;
    const avgPnl   = a.total > 0 ? a.pnlSum / a.total : 0;
    const pf       = a.pfLossSum > 0 ? a.pfWinSum / a.pfLossSum : (a.pfWinSum > 0 ? 99 : 1);
    const freq     = a.symCount > 0 ? a.freqSum / a.symCount : 0;
    const sc       = scoreModel({ avgPnl, winRate, profitFactor: pf, tradeFreq: freq });
    return { ...a, winRate, avgPnl, profitFactor: pf, tradeFreq: freq, score: sc };
  }).sort((a,b) => b.score.total - a.score.total);
}

// ══════════════════════════════════════════════════════════════════════
// CSV 생성
// ══════════════════════════════════════════════════════════════════════
function buildCSV(allSymResults, aggModels) {
  const lines = [
    "=== 심볼별 원본 데이터 ===",
    "symbol,tf,detectionVer,boxes,modelId,label,total,wins,losses,partials,winRate%,avgPnl%,totalPnl%,profitFactor,tradeFreq,score",
  ];
  for (const sym of allSymResults) {
    if (!sym.rows?.length) continue;
    for (const r of sym.rows) {
      const sc = scoreModel(r);
      lines.push([
        sym.symbol, sym.tf, r.grp,
        r.boxes, r.modelId, `"${r.label}"`,
        r.total, r.wins, r.losses, r.partials,
        r.winRate.toFixed(2), r.avgPnl.toFixed(4), r.totalPnl.toFixed(4),
        r.profitFactor.toFixed(3), r.tradeFreq.toFixed(3), sc.total,
      ].join(","));
    }
  }
  lines.push("", "=== 전체 집계 ===");
  lines.push("rank,grp,modelId,label,총박스,총거래,승,패,분할익절,승률%,기대수익%,수익팩터,종합점수,등급");
  aggModels.forEach((a, i) => {
    const g = scoreGrade(a.score.total);
    lines.push([
      i+1, a.grp, a.modelId, `"${a.label}"`,
      a.boxes, a.total, a.wins, a.losses, a.partials,
      a.winRate.toFixed(2), a.avgPnl.toFixed(4), a.profitFactor.toFixed(3),
      a.score.total, g.grade,
    ].join(","));
  });
  return lines.join("\n");
}

// ══════════════════════════════════════════════════════════════════════
// 이메일 HTML
// ══════════════════════════════════════════════════════════════════════
const CSS = `
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#111;max-width:1100px;margin:0 auto;padding:26px 16px;background:#f8fafc;}
h1{font-size:1.22em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:8px;}
h2{font-size:1.05em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:9px;margin-top:26px;}
h3{color:#374151;margin:12px 0 6px;font-size:.94em;}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:.84em;}
th{background:#1e40af;color:#fff;padding:8px 10px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center;white-space:nowrap;}
td.L{text-align:left;}
tr:hover td{background:#f0f4ff;}
.win{color:#15803d;font-weight:bold;}
.loss{color:#b91c1c;font-weight:bold;}
.dim{color:#9ca3af;}
.top1{background:#fef9c3;font-weight:bold;}
.top2{background:#f0fdf4;}
.top3{background:#eff6ff;}
.section{background:#fff;border:1px solid #e5e7eb;border-radius:9px;padding:16px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.05);}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;margin:8px 0;}
.hl{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin:8px 0;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin:8px 0;}
.grpV1{background:#e0f2fe;color:#0369a1;padding:1px 7px;border-radius:5px;font-size:.8em;}
.grpV2{background:#dcfce7;color:#15803d;padding:1px 7px;border-radius:5px;font-size:.8em;}
code{background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:.86em;font-family:monospace;}
ul li{margin:3px 0;}
.footer{color:#9ca3af;font-size:.82em;margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;}
`;

function mkBadge(r) {
  return `<span style="background:${r.badge};color:#fff;padding:1px 7px;border-radius:8px;font-size:.79em;">${r.label}</span>`;
}
function mkGrp(g) {
  return g === "V1"
    ? `<span class="grpV1">V1</span>`
    : `<span class="grpV2">V2+</span>`;
}
function scoreBar(s) {
  const g = scoreGrade(s);
  const w = Math.round(s);
  return `<div style="display:flex;align-items:center;gap:6px;">
    <div style="width:${w}px;max-width:80px;height:10px;background:${g.color};border-radius:4px;"></div>
    <strong style="color:${g.color};font-size:1.05em;">${s}</strong>
    <span style="background:${g.color};color:#fff;padding:1px 6px;border-radius:4px;font-size:.8em;">${g.grade}</span>
  </div>`;
}

function buildEmail(allSymResults, aggModels, csvPath) {
  const subject = `[YSTOCK] 11개 모델 백테스팅 + 점수 종합평가 (${now})`;

  // 종합 순위 테이블
  const rankRows = aggModels.map((a, i) => {
    const cls = i===0?"top1":i===1?"top2":i===2?"top3":"";
    return `<tr class="${cls}">
  <td><strong>${i+1}</strong></td>
  <td class="L">${mkBadge(a)}</td>
  <td>${mkGrp(a.grp)}</td>
  <td>${a.boxes}</td>
  <td>${a.total}</td>
  <td class="${a.winRate>=55?"win":a.winRate>=45?"":"loss"}">${fmt(a.winRate)}%</td>
  <td>${a.partials > 0 ? `<span class="dim">(+${a.partials}분할)</span>` : "—"}</td>
  <td class="${a.avgPnl>=0?"win":"loss"}">${fmtP(a.avgPnl)}</td>
  <td class="${a.profitFactor>=1.5?"win":a.profitFactor>=1?"":"loss"}">${fmt(a.profitFactor)}</td>
  <td>${scoreBar(a.score.total)}</td>
</tr>`;
  }).join("");

  // 점수 세부 분석 테이블
  const scoreDetailRows = aggModels.map((a, i) => {
    const sc = a.score;
    return `<tr>
  <td><strong>${i+1}</strong></td>
  <td class="L">${mkBadge(a)}</td>
  <td class="${sc.expScore>=60?"win":sc.expScore>=30?"":"loss"}">${Math.round(sc.expScore)}</td>
  <td class="${sc.wrScore>=60?"win":sc.wrScore>=30?"":"loss"}">${Math.round(sc.wrScore)}</td>
  <td class="${sc.pfScore>=60?"win":sc.pfScore>=30?"":"loss"}">${Math.round(sc.pfScore)}</td>
  <td>${Math.round(sc.freqScore)}</td>
  <td><strong>${sc.total}</strong></td>
</tr>`;
  }).join("");

  // 심볼별 상세 (모델 그룹 V1/V2+ 비교)
  const symTargets = [...new Set(allSymResults.map(s => `${s.symbol}_${s.tf}`))];
  const symSections = allSymResults.map(sym => {
    if (!sym.rows?.length) return `<div class="section"><h3>${sym.symbol} ${sym.tf} <span class="dim">(${sym.error||"오류"})</span></h3></div>`;

    const rowsHtml = sym.rows.map(r => {
      const sc = scoreModel(r);
      const isBest = sym.rows.every(o => scoreModel(o).total <= sc.total);
      return `<tr class="${isBest?"top1":""}">
  <td class="L">${mkBadge(r)}</td>
  <td>${mkGrp(r.grp)}</td>
  <td>${r.total}${r.partials>0?`<span class="dim">(+${r.partials})</span>`:""}</td>
  <td class="${r.winRate>=55?"win":r.winRate>=45?"":"loss"}">${fmt(r.winRate)}%</td>
  <td class="${r.avgPnl>=0?"win":"loss"}">${fmtP(r.avgPnl)}</td>
  <td class="${r.totalPnl>=0?"win":"loss"}">${fmtP(r.totalPnl,1)}</td>
  <td>${fmt(r.profitFactor)}</td>
  <td>${scoreBar(sc.total)}</td>
</tr>`;
    }).join("");

    return `<div class="section">
<h3>${sym.symbol} · ${sym.tf} · ${sym.candleCount}봉 · V1 ${sym.boxV1}박스 / V2 ${sym.boxV2}박스</h3>
<table>
<tr><th class="L">모델</th><th>탐지</th><th>거래</th><th>승률</th><th>기대수익</th><th>누적</th><th>PF</th><th>점수</th></tr>
${rowsHtml}
</table>
</div>`;
  }).join("");

  // 1위 모델 하이라이트
  const best = aggModels[0];
  const bestGrd = scoreGrade(best.score.total);

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title><style>${CSS}</style></head><body>

<h1>🏆 11개 모델 백테스팅 + 종합 점수 평가</h1>
<p class="dim">${now} · BTC·ETH·SOL + AAPL·NVDA·MSFT·AMZN·GOOGL × 1h·1d · 총 11모델</p>

<div class="section">
<h2>🥇 종합 1위 모델</h2>
<div class="ok" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
  <div style="font-size:2.2em;font-weight:bold;color:${bestGrd.color};">${bestGrd.grade}</div>
  <div>
    <div style="font-size:1.1em;font-weight:bold;">${best.label} <span class="dim">(${best.grp})</span></div>
    <div>종합점수 <strong style="color:${bestGrd.color};font-size:1.2em;">${best.score.total}점</strong> · ${bestGrd.label}</div>
    <div class="dim">승률 ${fmt(best.winRate)}% · 기대수익 ${fmtP(best.avgPnl)} · PF ${fmt(best.profitFactor)}</div>
  </div>
</div>
</div>

<div class="section">
<h2>📊 전체 모델 순위</h2>
<div class="hl" style="margin-bottom:10px;">
점수 = 기대수익(40%) + 승률(25%) + 수익팩터(20%) + 진입빈도(15%) · 각 항목 0~100점 정규화
</div>
<table>
<tr><th>순위</th><th class="L">모델</th><th>탐지</th><th>박스</th><th>거래수</th><th>승률</th><th>분할익절</th><th>기대수익</th><th>수익팩터</th><th>종합점수</th></tr>
${rankRows}
</table>
<p class="dim">※ 분할익절: TP_PARTIAL (mid 도달 후 SL→손익분기 처리된 거래)</p>
</div>

<div class="section">
<h2>📐 점수 세부 항목 (각 0~100점)</h2>
<table>
<tr><th>순위</th><th class="L">모델</th><th>기대수익(×0.40)</th><th>승률(×0.25)</th><th>수익팩터(×0.20)</th><th>진입빈도(×0.15)</th><th>합계</th></tr>
${scoreDetailRows}
</table>
<p class="dim">기대수익: 0%=0pt, 2.5%=100pt · 승률: 30%=0pt, 70%=100pt · 수익팩터: 1.0=0pt, 4.0=100pt · 빈도: 0=0pt, 1.5=100pt</p>
</div>

<div class="section">
<h2>🔑 핵심 발견</h2>
<ul>
${aggModels.slice(0,3).map((a,i)=>
  `<li>${["🥇","🥈","🥉"][i]} <strong>${a.label}</strong>: 승률 ${fmt(a.winRate)}%, 기대수익 ${fmtP(a.avgPnl)}, 점수 ${a.score.total}</li>`
).join("")}
${aggModels.find(m=>m.label.includes("분할익절")) ?
  `<li>⑧ 분할익절 모델: "이길 때 크게, 질 때 작게" 전략 → 분할 익절(TP_PARTIAL) ${aggModels.find(m=>m.label.includes("분할익절"))?.partials||0}건</li>` : ""}
${aggModels.find(m=>m.label.includes("거래량")) ?
  `<li>⑨ 거래량필터: 고거래량 이탈 skip → 진짜 가짜이탈만 포착</li>` : ""}
</ul>
<div class="warn">
<strong>백테스팅 주의:</strong> 수수료·슬리피지 미반영 · look-ahead bias 일부 포함 · 실제 체결가 차이 가능
</div>
</div>

<h2>📋 심볼별 상세 결과</h2>
${symSections}

<div class="section">
<h2>📁 원본 데이터</h2>
<div class="hl">
CSV 파일 저장 위치: <code>${csvPath}</code><br>
전체 심볼×모델 조합 ${allSymResults.reduce((s,r)=>s+(r.rows?.length||0),0)}행 포함
</div>
</div>

<div class="footer">
YSTOCK 11개 모델 종합 백테스팅 · ${now}<br>
V1: <code>box-range-pro-core.js</code> · V2+: <code>box-range-v2-core.js</code> + 개선 FSM
</div>
</body></html>`;

  const topLine = aggModels.slice(0,3).map((a,i)=>`${i+1}위 ${a.label}(${a.score.total}점)`).join(" / ");
  return { subject, html, text: `[YSTOCK] 11개 모델 백테스팅 + 점수 평가 (${now})\n\n${topLine}\n\nCSV: ${csvPath}` };
}

// ══════════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════════
const TARGETS = [
  { symbol:"BTC-USDT", isCrypto:true,  tfs:["1h","1d"] },
  { symbol:"ETH-USDT", isCrypto:true,  tfs:["1h","1d"] },
  { symbol:"SOL-USDT", isCrypto:true,  tfs:["1h","1d"] },
  { symbol:"AAPL",     isCrypto:false, tfs:["1h","1d"] },
  { symbol:"NVDA",     isCrypto:false, tfs:["1h","1d"] },
  { symbol:"MSFT",     isCrypto:false, tfs:["1h","1d"] },
  { symbol:"AMZN",     isCrypto:false, tfs:["1h","1d"] },
  { symbol:"GOOGL",    isCrypto:false, tfs:["1h","1d"] },
];

console.log("11개 모델 백테스팅 시작...\n");
const allSymResults = [];

for (const t of TARGETS) {
  for (const tf of t.tfs) {
    process.stdout.write(`  ${t.symbol} ${tf}... `);
    const r = await backtestSymbol(t.symbol, tf, t.isCrypto);
    allSymResults.push(r);
    if (r.error) {
      console.log(`오류: ${r.error}`);
    } else {
      const best = r.rows.reduce((b,m) => {
        const sc = scoreModel(m); const bsc = scoreModel(b);
        return sc.total > bsc.total ? m : b;
      }, r.rows[0]);
      const sc = scoreModel(best);
      console.log(`OK  V1:${r.boxV1}박스 V2:${r.boxV2}박스 | 최고: ${best.label}(${sc.total}점)`);
    }
    await new Promise(res => setTimeout(res, 800));
  }
}

// 전체 집계 + 점수
const aggModels = aggregateAll(allSymResults);

// CSV 저장
const ts = new Date().toISOString().slice(0,19).replace(/[T:]/g,"-");
const csvPath = path.resolve(`scripts/backtest-results-${ts}.csv`);
fs.writeFileSync(csvPath, buildCSV(allSymResults, aggModels), "utf-8");
console.log(`\nCSV 저장: ${csvPath}`);

// 이메일 전송
if (!isEmailSendingConfigured()) { console.error("SMTP 미설정"); process.exit(1); }
const email = buildEmail(allSymResults, aggModels, csvPath);
await sendTransactionalEmail({ to: TO, subject: email.subject, text: email.text, html: email.html });
console.log(`✓ 이메일 전송 → ${TO}`);
console.log("\n완료.");
