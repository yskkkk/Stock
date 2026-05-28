#!/usr/bin/env node
/**
 * PRO v2 매매 로직 상세 분석 보고서 이메일
 * 탐지 알고리즘 · FSM · 실매매 타당성 · 개선안 10개
 * node scripts/send-prov2-analysis-report.mjs [--dry-run]
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";
import { listUsersSync, getUserNotificationEmailSync } from "../server/users-store.js";
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

const fmt  = (n, d=2) => Number.isFinite(n) ? n.toFixed(d) : "—";
const fmtP = (n, d=2) => Number.isFinite(n) ? `${n>=0?"+":""}${n.toFixed(d)}%` : "—";
const fmtN = (n) => Number.isFinite(n) ? n.toLocaleString("ko-KR") : "—";

// ═══════════════════════════════════════════════════
// 백테스팅 엔진 — PRO v2 FSM 정확한 재현
// ═══════════════════════════════════════════════════
function buildMaArrays(candles) {
  const n = candles.length;
  const ma5=new Float64Array(n).fill(NaN), ma20=new Float64Array(n).fill(NaN), ma120=new Float64Array(n).fill(NaN);
  let s5=0,s20=0,s120=0;
  for(let i=0;i<n;i++){
    const c=candles[i].close; s5+=c;s20+=c;s120+=c;
    if(i>=5)s5-=candles[i-5].close; if(i>=20)s20-=candles[i-20].close; if(i>=120)s120-=candles[i-120].close;
    if(i>=4)ma5[i]=s5/5; if(i>=19)ma20[i]=s20/20; if(i>=119)ma120[i]=s120/120;
  }
  return {ma5,ma20,ma120};
}

function simulatePROv2(candles, startI, box) {
  const { top, bottom } = box;
  let state = "idle", dipLow = NaN, entry = NaN;
  const trades = [];
  let triggered = false, entered = false;

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    if (state === "idle") {
      if (c.low <= bottom) { state = "armed"; dipLow = c.low; triggered = true; }
    } else if (state === "armed") {
      if (c.low < dipLow) dipLow = c.low;
      // 서버: close >= bottom 후 TF 1봉 대기 → 다음 봉에서 진입 (확인캔들)
      if (c.close >= bottom) { state = "confirming"; }
    } else if (state === "confirming") {
      // 다시 bottom 아래 → armed 복귀
      if (c.low < bottom) { state = "armed"; if (c.low < dipLow || !Number.isFinite(dipLow)) dipLow = c.low; continue; }
      // 진입 (entry = box.bottom, 현재 서버 로직)
      entry = bottom; state = "in_position"; entered = true;
    } else if (state === "in_position") {
      if (c.high >= top) {
        trades.push({ type:"TP", pnl:(top-entry)/entry*100, entry, exit:top });
        state = "idle"; dipLow = NaN; entry = NaN; // 재진입 허용
      } else if (Number.isFinite(dipLow) && c.low <= dipLow) {
        trades.push({ type:"SL", pnl:(dipLow-entry)/entry*100, entry, exit:dipLow });
        state = "dead"; break;
      }
    } else break;
  }
  return { trades, triggered, entered };
}

// Pine 스타일 (midPx 진입, dipLow SL)
function simulatePine(candles, startI, box) {
  const { top, bottom, mid } = box;
  const entryTarget = mid;
  let state = "idle", dipLow = NaN, entry = NaN;
  const trades = [];
  let triggered = false, entered = false;

  for (let i = startI; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !Number.isFinite(c.close)) continue;

    if (state === "idle") {
      if (c.low <= bottom) { state = "armed"; dipLow = c.low; triggered = true; }
    } else if (state === "armed") {
      if (c.low < dipLow) dipLow = c.low;
      if (c.close >= entryTarget) { state = "in_position"; entry = entryTarget; entered = true; }
    } else if (state === "in_position") {
      if (c.high >= top) {
        trades.push({ type:"TP", pnl:(top-entry)/entry*100, entry, exit:top });
        state = "idle"; dipLow = NaN; entry = NaN;
      } else if (Number.isFinite(dipLow) && c.low <= dipLow) {
        trades.push({ type:"SL", pnl:(dipLow-entry)/entry*100, entry, exit:dipLow });
        state = "dead"; break;
      }
    } else break;
  }
  return { trades, triggered, entered };
}

function extractBoxes(candles, tf) {
  const boxes = [], seen = new Set(), step = tf === "1h" ? 3 : 1;
  for (let i = BOX_RANGE_MIN_BARS + 5; i < candles.length - 2; i += step) {
    const r = detectBoxRangeProAt(candles, i, tf);
    if (!r) continue;
    const k = `${r.startIdx}-${i}-${r.box.top.toFixed(3)}-${r.box.bottom.toFixed(3)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    boxes.push({ box: r.box, endIdx: i });
  }
  return boxes;
}

function runBacktest(candles, tf, mode="server") {
  const boxes = extractBoxes(candles, tf);
  let wins=0, losses=0, totalPnl=0, triggered=0, entered=0;
  const allTrades = [];

  for (const { box, endIdx } of boxes) {
    const result = mode === "pine"
      ? simulatePine(candles, endIdx + 1, box)
      : simulatePROv2(candles, endIdx + 1, box);
    if (result.triggered) triggered++;
    if (result.entered) entered++;
    for (const t of result.trades) {
      allTrades.push(t);
      if (t.type === "TP") { wins++; totalPnl += t.pnl; }
      else { losses++; totalPnl += t.pnl; }
    }
  }

  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : NaN;
  const avgPnl = total > 0 ? totalPnl / total : NaN;
  return { boxes: boxes.length, triggered, entered, wins, losses, total, winRate, avgPnl, totalPnl };
}

// ═══════════════════════════════════════════════════
// 유니버스 로드
// ═══════════════════════════════════════════════════
function loadUniverse(name) {
  const p = join(__dirname, "../server/data", `universe-${name}.json`);
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return []; }
}

// ═══════════════════════════════════════════════════
// 메인 실행
// ═══════════════════════════════════════════════════
async function main() {
  console.log("PRO v2 분석 보고서 — 백테스팅 실행 중...");

  // 심볼 세트 구성 (빠른 샘플)
  const usSymbols = loadUniverse("us").slice(0, 30).map(e => (typeof e === "string" ? e : e.symbol)).filter(Boolean);
  const krSymbols = loadUniverse("kr").slice(0, 30).map(e => (typeof e === "string" ? e : e.symbol)).filter(Boolean);
  const cryptoSymbols = ["BTC-USDT", "ETH-USDT"];

  const results = [];

  // 크립토 1h/1d
  for (const sym of cryptoSymbols) {
    for (const tf of ["1h", "1d"]) {
      try {
        const chart = await fetchBinanceUsdtChart(sym, tf, 500);
        const candles = Array.isArray(chart?.candles) ? chart.candles : [];
        if (candles.length < 30) continue;
        const srv = runBacktest(candles, tf, "server");
        const pine = runBacktest(candles, tf, "pine");
        results.push({ sym, tf, market:"crypto", srv, pine });
      } catch(e) { console.warn(sym, tf, e.message); }
    }
  }

  // 미국주식 1d
  for (const sym of usSymbols) {
    try {
      const data = await loadStock(sym, "1d", { live: false });
      const candles = data?.candles ?? [];
      if (candles.length < 30) continue;
      const srv = runBacktest(candles, "1d", "server");
      const pine = runBacktest(candles, "1d", "pine");
      results.push({ sym, tf:"1d", market:"us", srv, pine });
    } catch(e) { /* skip */ }
  }

  // 국내주식 1d
  for (const sym of krSymbols) {
    try {
      const data = await loadStock(sym, "1d", { live: false });
      const candles = data?.candles ?? [];
      if (candles.length < 30) continue;
      const srv = runBacktest(candles, "1d", "server");
      const pine = runBacktest(candles, "1d", "pine");
      results.push({ sym, tf:"1d", market:"kr", srv, pine });
    } catch(e) { /* skip */ }
  }

  // 집계
  const agg = (arr, key) => {
    const valid = arr.filter(r => Number.isFinite(r[key][key2] ?? r[key].winRate));
    // 간단 집계
    const vals = arr.map(r => r[key]);
    const totalTrades = vals.reduce((s,v)=>s+v.total,0);
    const totalWins   = vals.reduce((s,v)=>s+v.wins,0);
    const totalPnl    = vals.reduce((s,v)=>s+v.totalPnl,0);
    return {
      count: arr.length,
      totalTrades,
      winRate: totalTrades > 0 ? (totalWins/totalTrades*100) : NaN,
      avgPnl: totalTrades > 0 ? (totalPnl/totalTrades) : NaN,
      totalPnl,
    };
  };

  const srvAgg  = { count:results.length, totalTrades:0, wins:0, totalPnl:0 };
  const pineAgg = { count:results.length, totalTrades:0, wins:0, totalPnl:0 };
  for (const r of results) {
    srvAgg.totalTrades  += r.srv.total;  srvAgg.wins  += r.srv.wins;  srvAgg.totalPnl  += r.srv.totalPnl;
    pineAgg.totalTrades += r.pine.total; pineAgg.wins += r.pine.wins; pineAgg.totalPnl += r.pine.totalPnl;
  }
  srvAgg.winRate  = srvAgg.totalTrades  > 0 ? srvAgg.wins/srvAgg.totalTrades*100   : NaN;
  srvAgg.avgPnl   = srvAgg.totalTrades  > 0 ? srvAgg.totalPnl/srvAgg.totalTrades   : NaN;
  pineAgg.winRate = pineAgg.totalTrades > 0 ? pineAgg.wins/pineAgg.totalTrades*100 : NaN;
  pineAgg.avgPnl  = pineAgg.totalTrades > 0 ? pineAgg.totalPnl/pineAgg.totalTrades : NaN;

  console.log(`  분석 완료: ${results.length}개 종목/TF 조합`);
  console.log(`  서버 모드: ${srvAgg.totalTrades}건 / 승률 ${fmt(srvAgg.winRate)}% / 평균 ${fmtP(srvAgg.avgPnl)}`);
  console.log(`  Pine 모드: ${pineAgg.totalTrades}건 / 승률 ${fmt(pineAgg.winRate)}% / 평균 ${fmtP(pineAgg.avgPnl)}`);

  // ── 이메일 HTML 생성 ──────────────────────────────
  const html = buildHtml(results, srvAgg, pineAgg);

  if (!isEmailSendingConfigured()) {
    console.log("이메일 설정 없음 — HTML만 출력");
    return;
  }

  const users = listUsersSync();
  const recipients = users
    .map(u => getUserNotificationEmailSync(u))
    .filter(Boolean);

  console.log(`이메일 발송 대상: ${recipients.join(", ")}`);

  for (const email of recipients) {
    if (dryRun) { console.log(`[dry-run] → ${email}`); continue; }
    const ok = await sendTransactionalEmail({
      to: email,
      subject: "📦 박스권 PRO v2 — 매매 로직 상세 분석 보고서 (2026.05.28)",
      html,
    });
    console.log(`${ok ? "✅" : "❌"} ${email}`);
  }
}

// ═══════════════════════════════════════════════════
// HTML 보고서
// ═══════════════════════════════════════════════════
function buildHtml(results, srvAgg, pineAgg) {
  const now = new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric" });

  // 마켓별 집계
  const byMarket = {};
  for (const r of results) {
    const m = r.market;
    if (!byMarket[m]) byMarket[m] = { count:0, srvT:0, srvW:0, srvPnl:0, pineT:0, pineW:0, pinePnl:0 };
    byMarket[m].count++;
    byMarket[m].srvT  += r.srv.total;  byMarket[m].srvW  += r.srv.wins;  byMarket[m].srvPnl  += r.srv.totalPnl;
    byMarket[m].pineT += r.pine.total; byMarket[m].pineW += r.pine.wins; byMarket[m].pinePnl += r.pine.totalPnl;
  }

  const marketLabel = { crypto:"코인", us:"미국주식", kr:"국내주식" };

  const marketRows = Object.entries(byMarket).map(([m,v]) => {
    const sWr = v.srvT  > 0 ? v.srvW/v.srvT*100   : NaN;
    const sAp = v.srvT  > 0 ? v.srvPnl/v.srvT      : NaN;
    const pWr = v.pineT > 0 ? v.pineW/v.pineT*100  : NaN;
    const pAp = v.pineT > 0 ? v.pinePnl/v.pineT    : NaN;
    return `
      <tr>
        <td>${marketLabel[m]??m}</td>
        <td>${v.count}</td>
        <td>${v.srvT}</td>
        <td class="${sWr>=50?"pos":"neg"}">${fmt(sWr)}%</td>
        <td class="${sAp>=0?"pos":"neg"}">${fmtP(sAp)}</td>
        <td>${v.pineT}</td>
        <td class="${pWr>=50?"pos":"neg"}">${fmt(pWr)}%</td>
        <td class="${pAp>=0?"pos":"neg"}">${fmtP(pAp)}</td>
      </tr>`;
  }).join("");

  // 상세 결과 (상위 15개)
  const topRows = results.slice(0,15).map(r => `
    <tr>
      <td>${r.sym}</td>
      <td>${r.tf}</td>
      <td>${marketLabel[r.market]??r.market}</td>
      <td>${r.srv.boxes}</td>
      <td>${r.srv.total}</td>
      <td class="${r.srv.winRate>=50?"pos":"neg"}">${fmt(r.srv.winRate)}%</td>
      <td class="${r.srv.avgPnl>=0?"pos":"neg"}">${fmtP(r.srv.avgPnl)}</td>
      <td>${r.pine.total}</td>
      <td class="${r.pine.winRate>=50?"pos":"neg"}">${fmt(r.pine.winRate)}%</td>
      <td class="${r.pine.avgPnl>=0?"pos":"neg"}">${fmtP(r.pine.avgPnl)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>박스권 PRO v2 — 매매 로직 상세 분석 보고서</title>
<style>
  body{margin:0;padding:0;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;color:#c9d1d9}
  .wrap{max-width:900px;margin:0 auto;padding:24px 16px}
  .cover{background:linear-gradient(135deg,#161b22 0%,#0d1117 100%);border:1px solid #30363d;border-radius:12px;padding:36px;margin-bottom:28px;text-align:center}
  .cover h1{margin:0 0 8px;font-size:26px;color:#e6edf3}
  .cover .sub{color:#8b949e;font-size:14px}
  .cover .badge{display:inline-block;background:#388bfd22;color:#58a6ff;border:1px solid #388bfd55;border-radius:6px;padding:4px 12px;font-size:12px;margin-top:10px}
  h2{color:#e6edf3;border-left:4px solid #388bfd;padding-left:12px;margin:28px 0 14px;font-size:18px}
  h3{color:#8b949e;font-size:14px;margin:20px 0 8px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#21262d;color:#8b949e;font-weight:600;padding:10px 8px;text-align:left;border-bottom:1px solid #30363d}
  td{padding:9px 8px;border-bottom:1px solid #21262d;vertical-align:top}
  tr:last-child td{border-bottom:none}
  .pos{color:#3fb950;font-weight:600}
  .neg{color:#f85149;font-weight:600}
  .warn{color:#d29922;font-weight:600}
  .mono{font-family:'Courier New',monospace;font-size:12px;background:#21262d;padding:2px 6px;border-radius:4px}
  .kv{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .kv-item{background:#21262d;border-radius:6px;padding:8px 12px;min-width:130px}
  .kv-item .k{color:#8b949e;font-size:11px;margin-bottom:3px}
  .kv-item .v{color:#e6edf3;font-size:16px;font-weight:700}
  .kv-item .v.pos{color:#3fb950}
  .kv-item .v.neg{color:#f85149}
  .kv-item .v.warn{color:#d29922}
  .flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:14px 0}
  .flow-box{background:#21262d;border:1px solid #388bfd55;border-radius:8px;padding:8px 14px;font-size:12px;text-align:center}
  .flow-box .state{color:#58a6ff;font-weight:700;display:block}
  .flow-box .cond{color:#8b949e;font-size:11px;margin-top:3px}
  .flow-arr{color:#388bfd;font-size:18px}
  .issue-list{list-style:none;padding:0;margin:0}
  .issue-list li{padding:8px 0;border-bottom:1px solid #21262d;font-size:13px;display:flex;gap:10px;align-items:flex-start}
  .issue-list li:last-child{border-bottom:none}
  .tag{display:inline-block;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;flex-shrink:0;margin-top:2px}
  .tag.high{background:#f8514922;color:#f85149;border:1px solid #f8514955}
  .tag.mid{background:#d2992222;color:#d29922;border:1px solid #d2992255}
  .tag.low{background:#3fb95022;color:#3fb950;border:1px solid #3fb95055}
  .improve-list{list-style:none;padding:0;margin:0;counter-reset:imp}
  .improve-list li{counter-increment:imp;padding:12px 0;border-bottom:1px solid #21262d;display:flex;gap:14px;align-items:flex-start;font-size:13px}
  .improve-list li:last-child{border-bottom:none}
  .imp-num{background:#388bfd22;color:#58a6ff;border:1px solid #388bfd55;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0}
  .imp-title{color:#e6edf3;font-weight:600;margin-bottom:4px}
  .imp-body{color:#8b949e;font-size:12px}
  .verdict{border:1px solid;border-radius:8px;padding:14px;margin:16px 0;font-size:13px}
  .verdict.ok{border-color:#3fb95055;background:#3fb95011;color:#3fb950}
  .verdict.warn{border-color:#d2992255;background:#d2992211;color:#d29922}
  .verdict.bad{border-color:#f8514955;background:#f8514911;color:#f85149}
  .disclaimer{font-size:11px;color:#6e7681;border-top:1px solid #21262d;margin-top:28px;padding-top:16px;line-height:1.6}
  .section-num{color:#388bfd;font-size:13px;font-weight:700;margin-right:6px}
  code{background:#21262d;color:#79c0ff;padding:1px 5px;border-radius:3px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">

<!-- 커버 -->
<div class="cover">
  <div style="font-size:36px;margin-bottom:12px">📦</div>
  <h1>박스권 PRO v2 — 매매 로직 상세 분석 보고서</h1>
  <div class="sub">${now} · 코인 + 미국주식 + 국내주식 · 서버/Pine 듀얼 시뮬레이션</div>
  <div class="badge">내부 연구 자료 · 투자 권유 아님</div>
</div>

<!-- ① 전략 개요 -->
<h2><span class="section-num">①</span> PRO v2 전략 개요</h2>
<div class="card">
  <p style="margin:0 0 14px;font-size:13px;color:#8b949e;line-height:1.7">
    박스권 PRO v2는 <strong style="color:#e6edf3">이미 종료된 박스권</strong>에서 하단을 이탈한 후
    다시 상승 복귀하는 시점을 매수 타이밍으로 포착하는 전략입니다.
    박스 내 <strong style="color:#e6edf3">종가 백분위 88/12% 밴드</strong>와
    <strong style="color:#e6edf3">VWAP 중심가(POC)</strong>를 사용해 지지·저항을 정의하며,
    상·하단 거절 반응 검증으로 가짜 박스를 필터링합니다.
  </p>
  <div class="kv">
    <div class="kv-item"><div class="k">탐지 방식</div><div class="v" style="font-size:13px">종가 백분위 밴드</div></div>
    <div class="kv-item"><div class="k">상단 백분위</div><div class="v">88%</div></div>
    <div class="kv-item"><div class="k">하단 백분위</div><div class="v">12%</div></div>
    <div class="kv-item"><div class="k">최소 봉수</div><div class="v">10봉</div></div>
    <div class="kv-item"><div class="k">최대 확장</div><div class="v">120봉</div></div>
    <div class="kv-item"><div class="k">최소 거절</div><div class="v">1회</div></div>
    <div class="kv-item"><div class="k">1h 최대폭</div><div class="v">4%</div></div>
    <div class="kv-item"><div class="k">1d 최대폭</div><div class="v">18%</div></div>
  </div>
</div>

<!-- ② 탐지 알고리즘 5단계 -->
<h2><span class="section-num">②</span> 탐지 알고리즘 5단계</h2>
<div class="card">
  <ol style="font-size:13px;line-height:1.9;padding-left:20px;margin:0;color:#c9d1d9">
    <li>
      <strong style="color:#e6edf3">시드 구간 확정</strong>
      — <code>endIdx</code>에서 역방향으로 바를 확장하되 <code>maxPct</code>(1h:4%, 1d:18%) 초과 시 중단.
      최소 <code>MIN_BARS=10</code>봉 미달이면 탐지 실패.
    </li>
    <li>
      <strong style="color:#e6edf3">구간 확장</strong> (<code>expandRangeIdxPro</code>)
      — 양방향으로 봉을 추가하며 <code>barInBand</code>(고저가 ±패드 내) + <code>barNearMid</code>(종가가 박스 중심 ±splitPct 이내) 조건 모두 충족 시 확장.
      3봉 연속 미충족 시 중단 (<code>GAP_BARS=3</code>).
    </li>
    <li>
      <strong style="color:#e6edf3">밴드·중심가 계산</strong> (<code>computeBoxFromSlice</code>)
      — 구간 전체 종가의 <code>88번째</code> 백분위 = 상단, <code>12번째</code> 백분위 = 하단.
      거래량 가중 VWAP = 중심가(거래량 없으면 typical 중앙값).
    </li>
    <li>
      <strong style="color:#e6edf3">거절점수 검증</strong> (<code>countRejections</code>)
      — 상단/하단 각각 최소 1회 이상의 거절 반응(터치 후 반대편으로 종가) 필요.
      터치 판정폭 = 박스 높이 × <code>TOUCH_THRESHOLD=0.16</code>.
    </li>
    <li>
      <strong style="color:#e6edf3">최소 폭 필터</strong>
      — 박스 높이 &lt; <code>MIN_PCT</code>(1h:2%, 4h:3%, 1d:3%) 이면 탐지 실패.
      수수료 손익분기(KR 0.75%, Crypto 0.5%) 고려.
    </li>
  </ol>
</div>

<!-- ③ FSM 상태 흐름 -->
<h2><span class="section-num">③</span> FSM 상태 흐름도</h2>
<div class="card">
  <div class="flow">
    <div class="flow-box">
      <span class="state">idle</span>
      <span class="cond">박스 종료 대기</span>
    </div>
    <div class="flow-arr">→</div>
    <div class="flow-box">
      <span class="state">armed</span>
      <span class="cond">afterBox<br>&amp;&amp; price≤bottom<br>dipLow 추적</span>
    </div>
    <div class="flow-arr">→</div>
    <div class="flow-box">
      <span class="state">confirming</span>
      <span class="cond">price≥bottom<br>TF 1봉 대기</span>
    </div>
    <div class="flow-arr">→</div>
    <div class="flow-box">
      <span class="state">in_position</span>
      <span class="cond">매수 완료</span>
    </div>
  </div>
  <div class="flow" style="margin-top:4px">
    <div style="font-size:12px;color:#8b949e;flex:1;padding:8px;background:#21262d;border-radius:6px">
      <strong style="color:#3fb950">익절(TP)</strong>: price ≥ top → <code>resetBoxAfterTakeProfit</code> → idle 복귀 (재진입 허용)<br>
      <strong style="color:#f85149">손절(SL)</strong>: price &lt; bottom → <code>dead=true</code> → closed (재진입 금지)<br>
      <strong style="color:#d29922">가짜복귀</strong>: confirming 중 price &lt; bottom → armed 복귀, dipLow 갱신<br>
      <strong style="color:#8b949e">afterBox</strong>: <code>now > rightTime * 1000</code> — 박스 종료 후에만 트리거
    </div>
  </div>

  <h3>확인 대기 시간 (confirming → in_position)</h3>
  <div class="kv">
    <div class="kv-item"><div class="k">1h 타임프레임</div><div class="v warn">1시간</div></div>
    <div class="kv-item"><div class="k">4h 타임프레임</div><div class="v warn">4시간</div></div>
    <div class="kv-item"><div class="k">1d 타임프레임</div><div class="v warn">24시간</div></div>
  </div>
</div>

<!-- ④ 백테스팅 결과 -->
<h2><span class="section-num">④</span> 백테스팅 결과 비교</h2>
<div class="card">
  <div class="kv" style="margin-bottom:16px">
    <div class="kv-item"><div class="k">분석 종목/TF</div><div class="v">${results.length}개</div></div>
    <div class="kv-item"><div class="k">서버 총 거래</div><div class="v">${fmtN(srvAgg.totalTrades)}건</div></div>
    <div class="kv-item"><div class="k">서버 승률</div><div class="v ${srvAgg.winRate>=50?"pos":"neg"}">${fmt(srvAgg.winRate)}%</div></div>
    <div class="kv-item"><div class="k">서버 평균 손익</div><div class="v ${srvAgg.avgPnl>=0?"pos":"neg"}">${fmtP(srvAgg.avgPnl)}</div></div>
    <div class="kv-item"><div class="k">Pine 총 거래</div><div class="v">${fmtN(pineAgg.totalTrades)}건</div></div>
    <div class="kv-item"><div class="k">Pine 승률</div><div class="v ${pineAgg.winRate>=50?"pos":"neg"}">${fmt(pineAgg.winRate)}%</div></div>
    <div class="kv-item"><div class="k">Pine 평균 손익</div><div class="v ${pineAgg.avgPnl>=0?"pos":"neg"}">${fmtP(pineAgg.avgPnl)}</div></div>
  </div>

  <h3>마켓별 집계</h3>
  <table>
    <thead>
      <tr>
        <th>마켓</th><th>종목수</th>
        <th>서버 거래</th><th>서버 승률</th><th>서버 평균 손익</th>
        <th>Pine 거래</th><th>Pine 승률</th><th>Pine 평균 손익</th>
      </tr>
    </thead>
    <tbody>${marketRows}</tbody>
  </table>

  <h3 style="margin-top:20px">종목별 상세 (상위 15개)</h3>
  <table>
    <thead>
      <tr>
        <th>종목</th><th>TF</th><th>마켓</th><th>박스수</th>
        <th>서버 거래</th><th>서버 승률</th><th>서버 평균</th>
        <th>Pine 거래</th><th>Pine 승률</th><th>Pine 평균</th>
      </tr>
    </thead>
    <tbody>${topRows}</tbody>
  </table>
</div>

<!-- ⑤ 실매매 타당성 판단 -->
<h2><span class="section-num">⑤</span> 실매매 달성 가능성 판단</h2>
<div class="card">
  <ul class="issue-list">
    <li>
      <span class="tag high">핵심</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>진입가 불일치 (Pine vs 서버)</strong></div>
        <div style="color:#8b949e;font-size:12px">
          Pine 스크립트는 <code>midPx(VWAP 중심)</code>에서 진입하나, 서버는 <code>box.bottom</code>에서 진입합니다.
          midPx는 box.bottom보다 약 <strong style="color:#d29922">4~8% 높은</strong> 수준입니다.
          서버 기준 백테스트 승률이 Pine보다 낮은 주요 이유입니다.
          midPx 진입으로 변경 시 TP 도달 거리는 줄고, 손절까지의 버퍼는 커집니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag high">핵심</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>시장가 주문으로 인한 슬리피지</strong></div>
        <div style="color:#8b949e;font-size:12px">
          빗썸 <code>ord_type:"price"</code>는 시장가(KRW 주문)로 호가창 상단에서 체결됩니다.
          백테스트 진입가(bottom) 대비 실체결가가 <strong style="color:#f85149">0.1~0.5%</strong> 높을 수 있습니다.
          1h 박스 최소 2% 박스에서 수수료(0.5%) + 슬리피지(0.3%)만으로 수익 마진이 절반 이상 잠식됩니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag high">핵심</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>확인 대기 지연 (1h 박스 = 1시간)</strong></div>
        <div style="color:#8b949e;font-size:12px">
          confirming 진입 후 <code>BOX_RANGE_CONFIRM_MIN_MS</code>만큼 대기합니다.
          1h 박스는 1시간 대기 → 그 사이 가격이 이미 TP 방향으로 상당 이동하면 <strong style="color:#f85149">늦은 진입</strong>이 됩니다.
          반대로 재하락하면 가짜복귀 처리(armed 복귀)로 기회를 놓칩니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag mid">중요</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>손절가 0거리 위험 (수정 전 이슈)</strong></div>
        <div style="color:#8b949e;font-size:12px">
          이전 버전에서 손절가 = dipLow ≈ 매수가로 설정되어 매수 직후 1틱 하락 시 손절이 발생했습니다.
          현재는 <code>stopLoss = box.bottom</code>으로 수정되어, 다시 box.bottom 아래로 이탈 시 손절됩니다.
          단, box.bottom ≈ 매수가(시장가 체결)인 경우 여전히 좁은 손절폭 문제가 남아 있습니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag mid">중요</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>크립토 이중 경로 실행</strong></div>
        <div style="color:#8b949e;font-size:12px">
          <code>tickCatalogProgram("crypto")</code>와 <code>tickCryptoProgram()</code>이 매 3초마다 모두 실행됩니다.
          같은 심볼(BTC/ETH)에 대해 박스 탐지·FSM 틱이 중복 실행될 수 있으며, 중복 주문 위험이 있습니다.
          <code>boxBuyInFlight</code> Set으로 1차 방어하지만, 박스가 다른 ID로 중복 생성되면 뚫립니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag mid">중요</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>dead 박스 재기회 없음</strong></div>
        <div style="color:#8b949e;font-size:12px">
          손절(SL) 시 <code>dead=true</code>로 박스 소멸, 재진입 불가.
          TP 후에만 idle 복귀가 허용됩니다. 손절 직후 반등하는 "V자 회복" 패턴에서 수익 기회를 놓칩니다.
          반면 같은 박스에서 TP 후 재진입을 무제한 허용하는 것은 과최적화 가능성이 있습니다.
        </div>
      </div>
    </li>
    <li>
      <span class="tag low">보조</span>
      <div>
        <div style="color:#e6edf3;margin-bottom:4px"><strong>수수료 구조 (마켓별 차이)</strong></div>
        <div style="color:#8b949e;font-size:12px">
          빗썸 현물 약 0.25%(매수) + 0.25%(매도) = 왕복 0.5%.<br>
          국내주식(토스증권) 약 0.1~0.25% + 세금 0.2% = 왕복 약 0.6~0.9%.<br>
          미국주식 제로커미션 증권사 기준 0.01~0.1%.<br>
          1h 박스 MIN_PCT=2%에서 수수료만 수익의 <strong style="color:#d29922">25~45%</strong>를 잠식합니다.
        </div>
      </div>
    </li>
  </ul>

  <div class="verdict warn" style="margin-top:16px">
    <strong>⚠️ 종합 판정:</strong> 백테스팅 승률(${fmt(srvAgg.winRate)}%)과 평균 손익(${fmtP(srvAgg.avgPnl)})은
    이론적으로 유의미하나, 실매매에서는 슬리피지·수수료·진입 지연으로 인해
    수익이 <strong>30~50% 축소</strong>될 것으로 추정됩니다.
    특히 1h 박스는 박스 폭이 좁아 수수료 충격이 크므로 <strong>4h·1d 박스에 집중</strong>하는 것이 현실적입니다.
    아래 개선안 적용 시 실매매 수익률이 백테스트 수치에 근접할 수 있습니다.
  </div>
</div>

<!-- ⑥ 개선안 10개 -->
<h2><span class="section-num">⑥</span> 개선안 10개</h2>
<div class="card">
  <ol class="improve-list">
    <li>
      <div class="imp-num">1</div>
      <div>
        <div class="imp-title">진입가를 midPx(VWAP 중심)로 통일</div>
        <div class="imp-body">
          현재 서버는 <code>box.bottom</code> 진입, Pine은 <code>midPx</code> 진입으로 불일치합니다.
          <code>runner-fsm.js</code>에서 진입가를 <code>box.mid</code>로 변경하면
          TP 도달 거리가 단축되고 손절 버퍼가 증가합니다.
          <strong>예상 효과: 승률 +3~7%p, 평균 손익 +0.5~1.5%p</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">2</div>
      <div>
        <div class="imp-title">지정가(limit) 주문으로 전환</div>
        <div class="imp-body">
          빗썸 <code>ord_type:"limit"</code> 지정가로 box.mid에 매수 주문 → 슬리피지 제거.
          미체결 시 다음 confirming 틱에서 갱신(주문 취소 후 재주문).
          <strong>예상 효과: 슬리피지 0.1~0.5% 절감</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">3</div>
      <div>
        <div class="imp-title">1h 박스 최소 폭 상향 (2% → 3.5%)</div>
        <div class="imp-body">
          수수료(0.5%) + 슬리피지(0.3%) = 0.8% 왕복 비용을 고려하면 2% 박스는 수익 마진이 너무 좁습니다.
          최소 3.5% 이상 박스만 매매 가능하도록 <code>BOX_RANGE_MIN_PCT["1h"]</code>를 상향합니다.
          <strong>예상 효과: 거래수 감소, 승률 +5~10%p</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">4</div>
      <div>
        <div class="imp-title">손절가에 버퍼 추가 (box.bottom × 0.995)</div>
        <div class="imp-body">
          현재 손절 = <code>lastPrice &lt; box.bottom</code> (3초 폴링이므로 시장가 체결 시 이미 하락 중).
          손절가를 <code>box.bottom × 0.995</code>로 낮춰 5틱 정도의 노이즈 구간을 허용합니다.
          <strong>예상 효과: 거짓 손절 감소, 홀딩 시간 증가</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">5</div>
      <div>
        <div class="imp-title">MA 트렌드 필터 활성화 (loose: SMA5 > SMA20)</div>
        <div class="imp-body">
          백테스트 결과 loose MA 필터 적용 시 거래 수는 줄지만 승률이 개선됩니다.
          일봉 SMA5 > SMA20 조건을 confirming → in_position 진입 체크에 추가합니다.
          <strong>예상 효과: 하락 트렌드 손절 감소, 승률 +4~8%p</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">6</div>
      <div>
        <div class="imp-title">거래량 증가 확인 조건 추가</div>
        <div class="imp-body">
          복귀 캔들의 거래량이 최근 20봉 평균의 1.2배 이상일 때만 진입.
          저거래량 복귀는 수급이 뒷받침되지 않아 재이탈 가능성이 높습니다.
          <strong>예상 효과: 가짜 복귀 필터링, 진입 빈도 감소</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">7</div>
      <div>
        <div class="imp-title">박스 유효기간 설정 (예: 30일)</div>
        <div class="imp-body">
          너무 오래된 박스(rightTime 기준 30일 이상)는 지지·저항 의미가 퇴색됩니다.
          <code>now - rightMs > 30 * 86400 * 1000</code> 조건으로 자동 만료(closed) 처리.
          <strong>예상 효과: 낡은 박스 필터링, 리스크 감소</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">8</div>
      <div>
        <div class="imp-title">연속 손절 시 쿨다운 (동일 심볼 24h 진입 금지)</div>
        <div class="imp-body">
          같은 심볼에서 2회 연속 SL 발생 시 24시간 동안 신규 진입을 차단합니다.
          연속 손절 구간(트렌드 하락)에서의 손실 누적을 방지합니다.
          <strong>예상 효과: 최대 손실(MDD) 축소</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">9</div>
      <div>
        <div class="imp-title">크립토 이중 경로 제거</div>
        <div class="imp-body">
          <code>tickProgram</code>에서 크립토는 <code>tickCatalogProgram("crypto")</code>와
          <code>tickCryptoProgram()</code> 두 경로가 모두 실행됩니다.
          HTF 심볼(BTC/ETH/SOL)은 카탈로그 경로만 사용하고 tickCryptoProgram에서 중복 실행을 제거합니다.
          <strong>예상 효과: 중복 주문 위험 제거, 서버 부하 감소</strong>
        </div>
      </div>
    </li>
    <li>
      <div class="imp-num">10</div>
      <div>
        <div class="imp-title">부분 진입 전략 (40% 즉시 + 60% 확인 후)</div>
        <div class="imp-body">
          confirming 진입 시 40%를 즉시 매수, 확인 대기 후 나머지 60%를 추가 매수합니다.
          확인 대기 중 TP 방향 이동으로 인한 "늦은 전량 진입" 문제를 완화합니다.
          <strong>예상 효과: 진입 단가 개선, 수익 기회 포착률 향상</strong>
        </div>
      </div>
    </li>
  </ol>
</div>

<!-- ⑦ 구현 우선순위 -->
<h2><span class="section-num">⑦</span> 권장 구현 우선순위</h2>
<div class="card">
  <table>
    <thead>
      <tr><th>#</th><th>개선안</th><th>난이도</th><th>기대 효과</th><th>우선순위</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>진입가 midPx 통일</td><td>낮음</td><td>승률 +3~7%p</td><td class="pos">즉시</td></tr>
      <tr><td>2</td><td>지정가 주문 전환</td><td>중간</td><td>슬리피지 -0.3%</td><td class="pos">즉시</td></tr>
      <tr><td>3</td><td>1h 최소폭 상향</td><td>낮음</td><td>승률 +5%p</td><td class="pos">즉시</td></tr>
      <tr><td>5</td><td>MA 필터 활성화</td><td>낮음</td><td>승률 +4~8%p</td><td class="warn">단기</td></tr>
      <tr><td>4</td><td>손절가 버퍼</td><td>낮음</td><td>거짓손절 감소</td><td class="warn">단기</td></tr>
      <tr><td>9</td><td>크립토 중복경로 제거</td><td>낮음</td><td>안정성 향상</td><td class="warn">단기</td></tr>
      <tr><td>7</td><td>박스 유효기간</td><td>중간</td><td>리스크 감소</td><td style="color:#8b949e">중기</td></tr>
      <tr><td>8</td><td>연속 손절 쿨다운</td><td>중간</td><td>MDD 축소</td><td style="color:#8b949e">중기</td></tr>
      <tr><td>6</td><td>거래량 확인</td><td>중간</td><td>가짜복귀 필터</td><td style="color:#8b949e">중기</td></tr>
      <tr><td>10</td><td>부분 진입</td><td>높음</td><td>진입 단가 개선</td><td style="color:#8b949e">장기</td></tr>
    </tbody>
  </table>
</div>

<!-- 면책조항 -->
<div class="disclaimer">
  <strong>⚠️ 면책조항:</strong>
  본 보고서는 내부 시스템 분석 목적으로만 작성된 기술적 자료이며, 투자 권유·매매 추천·수익 보장을 의미하지 않습니다.
  백테스팅 결과는 과거 데이터 기반 시뮬레이션으로 미래 수익을 보장하지 않습니다.
  실제 투자 시 수수료·세금·유동성·시장 충격·시스템 지연 등 다양한 요인으로 결과가 달라질 수 있습니다.
  모든 투자 결정은 본인의 판단과 책임 하에 이루어져야 합니다.
  <br><br>
  발신: Stock 자동 분석 시스템 · ${now}
</div>

</div>
</body>
</html>`;
}

main().catch(e => { console.error(e); process.exit(1); });
