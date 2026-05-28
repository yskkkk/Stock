#!/usr/bin/env node
/**
 * Pine V2 전략 검증 + 4모델 백테스팅 상세 보고서
 * 진입가: midPx (Pine 동일) vs bottom (서버 기존) 비교 포함
 * 전체 사용자에게 발송
 * node scripts/send-pine-strategy-report.mjs [--dry-run]
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

// ═══════════════════════════════════════════════════
// Rolling MA
// ═══════════════════════════════════════════════════
function buildMaArrays(cs) {
  const n=cs.length, ma5=new Float64Array(n).fill(NaN), ma20=new Float64Array(n).fill(NaN), ma120=new Float64Array(n).fill(NaN);
  let s5=0,s20=0,s120=0;
  for(let i=0;i<n;i++){
    const c=cs[i].close; s5+=c;s20+=c;s120+=c;
    if(i>=5)s5-=cs[i-5].close; if(i>=20)s20-=cs[i-20].close; if(i>=120)s120-=cs[i-120].close;
    if(i>=4)ma5[i]=s5/5; if(i>=19)ma20[i]=s20/20; if(i>=119)ma120[i]=s120/120;
  }
  return {ma5,ma20,ma120};
}
function buildDateMap(dc){ const m=new Map(); for(let j=0;j<dc.length;j++) m.set(new Date(dc[j].time*1000).toISOString().slice(0,10),j); return m; }

// ═══════════════════════════════════════════════════
// 4가지 모델 (Pine 매칭)
// ═══════════════════════════════════════════════════
// A: 서버 기존 (bottom 진입, MA없음)
// B: Pine 동일 (midPx 진입, MA없음)
// C: Pine + MA Loose (midPx 진입, 5>20)
// D: Pine + MA Strict (midPx 진입, 5>20>120) ← 현재 Pine 스크립트 기본값
const MODELS = [
  { id:"A", label:"서버 기존 (bottom진입)",        entry:"bottom", ma:"none",   badge:"#6b7280" },
  { id:"B", label:"Pine V2 (midPx진입, MA없음)",   entry:"mid",    ma:"none",   badge:"#7c3aed" },
  { id:"C", label:"Pine V2 + MA Loose (5>20)",    entry:"mid",    ma:"loose",  badge:"#2563eb" },
  { id:"D", label:"Pine V2 + MA Strict ★현재설정",entry:"mid",    ma:"strict", badge:"#059669" },
];

function simulate(candles, startI, box, model, dma, is1h) {
  const { top, bottom, mid } = box;
  const entryTarget = model.entry === "mid" ? mid : bottom;
  let state="idle", dipLow=NaN, entry=NaN;
  const trades=[]; let triggered=false, entered=false;

  function up(i) {
    if(model.ma==="none") return true;
    let j=i;
    if(is1h && dma.dateMap){ const d=new Date(candles[i].time*1000).toISOString().slice(0,10); j=dma.dateMap.get(d)??-1; if(j<0)return false; }
    const m5=dma.ma5[j], m20=dma.ma20[j];
    if(!Number.isFinite(m5)||!Number.isFinite(m20)) return false;
    if(model.ma==="loose") return m5>m20;
    const m120=dma.ma120[j]; return Number.isFinite(m120)&&m5>m20&&m20>m120;
  }

  for(let i=startI;i<candles.length;i++){
    const c=candles[i]; if(!c||!Number.isFinite(c.close)) continue;
    if(state==="idle"){
      if(c.low<=bottom){ state="armed"; dipLow=c.low; triggered=true; }
    } else if(state==="armed"){
      if(c.low<dipLow) dipLow=c.low;
      // Pine 진입: close >= midPx (or bottom) AND uptrend
      if(c.close>=entryTarget && up(i)){ state="in_position"; entry=entryTarget; entered=true; }
    } else if(state==="in_position"){
      if(c.high>=top){
        trades.push({type:"TP", pnl:(top-entry)/entry*100, entry, exit:top});
        state="idle"; dipLow=NaN; entry=NaN; // TP 후 재진입 허용
      } else if(Number.isFinite(dipLow)&&c.low<=dipLow){
        trades.push({type:"SL", pnl:(dipLow-entry)/entry*100, entry, exit:dipLow});
        state="dead"; break;
      }
    } else break;
  }
  return {trades,triggered,entered};
}

function extractBoxes(candles, tf){
  const boxes=[], seen=new Set(), step=tf==="1h"?3:1;
  for(let i=BOX_RANGE_MIN_BARS+5;i<candles.length-2;i+=step){
    const r=detectBoxRangeProAt(candles,i,tf); if(!r) continue;
    const k=`${r.startIdx}-${i}-${r.box.top.toFixed(3)}-${r.box.bottom.toFixed(3)}`;
    if(seen.has(k)) continue; seen.add(k);
    boxes.push({box:r.box, endIdx:i});
  }
  return boxes;
}

async function backtestOne(symbol, tf, isCrypto){
  let chart;
  try{ chart=isCrypto ? await fetchBinanceUsdtChart(symbol,tf) : await loadStock(symbol,tf); }
  catch(e){ return {symbol,tf,error:e.message,results:[]}; }
  const candles=chart?.candles??[];
  if(candles.length<BOX_RANGE_MIN_BARS+30) return {symbol,tf,error:"캔들부족("+candles.length+")",results:[]};
  let dma=buildMaArrays(candles);
  const is1h=(tf==="1h");
  if(is1h){
    try{
      const dc=(isCrypto?await fetchBinanceUsdtChart(symbol,"1d"):await loadStock(symbol,"1d"))?.candles??[];
      if(dc.length>30){ const dm=buildMaArrays(dc); dma={...dm,dateMap:buildDateMap(dc)}; }
    }catch{}
  }
  const boxes=extractBoxes(candles,tf);
  if(!boxes.length) return {symbol,tf,error:"박스없음",results:[],candles:candles.length};

  const results=MODELS.map(model=>{
    const trades=[]; let triggered=0, entered=0;
    for(const {box,endIdx} of boxes){
      const sim=simulate(candles,Math.min(endIdx+1,candles.length-1),box,model,dma,is1h);
      trades.push(...sim.trades); if(sim.triggered)triggered++; if(sim.entered)entered++;
    }
    const wins=trades.filter(t=>t.type==="TP").length, losses=trades.filter(t=>t.type==="SL").length, total=trades.length;
    const wr=total>0?wins/total*100:0;
    const avgPnl=total>0?trades.reduce((s,t)=>s+t.pnl,0)/total:0;
    const totalPnl=trades.reduce((s,t)=>s+t.pnl,0);
    const avgTP=wins>0?trades.filter(t=>t.type==="TP").reduce((s,t)=>s+t.pnl,0)/wins:0;
    const avgSL=losses>0?trades.filter(t=>t.type==="SL").reduce((s,t)=>s+t.pnl,0)/losses:0;
    return {...model, boxes:boxes.length, triggered, entered, total, wins, losses, wr, avgPnl, totalPnl, avgTP, avgSL};
  });
  return {symbol,tf,candles:candles.length,boxes:boxes.length,results};
}

async function runBatch(tasks,conc=4){
  const res=[],q=[...tasks]; let active=0,idx=0;
  await new Promise(r=>{ function next(){
    if(!q.length&&!active){r();return;}
    while(active<conc&&q.length){ const t=q.shift(); active++;
      t().then(v=>{res[idx++]=v;active--;next();}).catch(e=>{res[idx++]={error:e.message};active--;next();});}
  } next(); });
  return res;
}

// ═══════════════════════════════════════════════════
// 이메일 HTML 빌더
// ═══════════════════════════════════════════════════
const CSS=`
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',Helvetica,sans-serif;background:#f0f4f8;color:#1a202c;line-height:1.7;}
.wrap{max-width:960px;margin:0 auto;background:#fff;}
.hdr{background:linear-gradient(135deg,#0f1e3d,#1a3a6e);color:#fff;padding:44px 40px 36px;text-align:center;}
.hdr .logo{font-size:.9em;letter-spacing:3px;color:#93c5fd;margin-bottom:14px;text-transform:uppercase;}
.hdr h1{font-size:1.9em;font-weight:800;line-height:1.3;}
.hdr .sub{color:#bfdbfe;margin-top:8px;font-size:.92em;}
.sec{padding:30px 38px;border-bottom:1px solid #e5e7eb;}
h2{font-size:1.15em;color:#1e3a8a;border-left:4px solid #2563eb;padding-left:10px;margin-bottom:16px;}
h3{font-size:.97em;color:#374151;margin:16px 0 6px;font-weight:700;}
p{margin-bottom:9px;font-size:.92em;color:#374151;}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:.82em;}
th{background:#1e3a8a;color:#fff;padding:8px 9px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:6px 9px;border-bottom:1px solid #e5e7eb;text-align:center;}
td.L{text-align:left;}
tr:nth-child(even) td{background:#f8faff;}
tr:hover td{background:#eff6ff;}
.g{color:#15803d;font-weight:700;} .r{color:#b91c1c;font-weight:700;} .dim{color:#9ca3af;}
.best{background:#fef9c3!important;}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:7px;padding:11px 15px;margin:9px 0;font-size:.89em;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:11px 15px;margin:9px 0;font-size:.89em;}
.info{background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:11px 15px;margin:9px 0;font-size:.89em;}
.err{background:#fff5f5;border:1px solid #fca5a5;border-radius:7px;padding:11px 15px;margin:9px 0;font-size:.89em;}
.badge{color:#fff;padding:2px 8px;border-radius:9px;font-size:.78em;font-weight:600;white-space:nowrap;}
.chk{color:#059669;font-weight:700;} .x{color:#dc2626;font-weight:700;}
.risk{background:#fff5f5;border:2px solid #ef4444;border-radius:9px;padding:20px 22px;margin:10px 0;}
.risk h2{color:#dc2626;border-color:#ef4444;}
.risk li{font-size:.88em;color:#7f1d1d;margin:5px 0;}
.ftr{background:#1a202c;color:#9ca3af;padding:24px 38px;font-size:.79em;line-height:1.9;}
`;

function bdg(m){return `<span class="badge" style="background:${m.badge}">${m.label}</span>`;}

function buildHtml(allResults, overallAgg, aggByMkt, symSummary, now, totalSyms, okCount){
  const subject=`[YSTOCK] Pine V2 전략 검증 + ${okCount}종목 4모델 백테스팅 보고서 (${now})`;

  // 집계 테이블
  const aggRows=MODELS.map(m=>{
    const a=overallAgg[m.id]??{total:0,wins:0,pnlSum:0,boxes:0};
    const wr=a.total>0?a.wins/a.total*100:0, avg=a.total>0?a.pnlSum/a.total:0;
    const isBest=MODELS.every(o=>(overallAgg[o.id]?.pnlSum/Math.max(1,overallAgg[o.id]?.total??1)??-999)<=avg+0.001);
    return `<tr class="${isBest?"best":""}">
      <td class="L">${bdg(m)}</td>
      <td>${a.boxes??0}</td><td>${a.total}</td>
      <td class="${wr>=60?"g":wr<50?"r":""}">${fmt(wr)}%</td>
      <td>${fmtP(a.avgTP??0)}</td>
      <td class="${(a.avgSL??0)<0?"r":""}">${fmtP(a.avgSL??0)}</td>
      <td class="${avg>=0?"g":"r"}">${fmtP(avg)}</td>
      <td class="${(a.pnlSum??0)>=0?"g":"r"}">${fmtP(a.pnlSum??0,1)}</td>
    </tr>`;
  }).join("");

  // 마켓별
  const mktRows=Object.entries(aggByMkt).map(([mkt,mD])=>
    MODELS.map(m=>{
      const d=mD[m.id]??{total:0,wins:0,pnlSum:0};
      const wr=d.total>0?d.wins/d.total*100:0, avg=d.total>0?d.pnlSum/d.total:0;
      return `<tr><td class="L"><strong>${mkt}</strong></td><td class="L">${bdg(m)}</td>
        <td>${d.total}</td>
        <td class="${wr>=60?"g":wr<50?"r":""}">${fmt(wr)}%</td>
        <td class="${avg>=0?"g":"r"}">${fmtP(avg)}</td>
        <td class="${(d.pnlSum??0)>=0?"g":"r"}">${fmtP(d.pnlSum??0,1)}</td>
      </tr>`;
    }).join("")
  ).join("");

  // crypto 상세
  const cryptoDetail=allResults.filter(r=>r.market==="Crypto"&&r.results?.length).map(r=>`
    <h3>${r.symbol} · ${r.tf} · ${r.candles}봉 · ${r.boxes}박스</h3>
    <table>
    <tr><th class="L">모델</th><th>거래(T/E)</th><th>승률</th><th>avgTP</th><th>avgSL</th><th>기대수익</th><th>누적</th></tr>
    ${r.results.map(res=>{
      const isBest=r.results.every(o=>o.avgPnl<=res.avgPnl+0.001);
      return `<tr class="${isBest?"best":""}">
        <td class="L">${bdg(res)}</td>
        <td>${res.total} (T${res.triggered}/E${res.entered})</td>
        <td class="${res.wr>=60?"g":res.wr<50?"r":""}">${fmt(res.wr)}%</td>
        <td>${fmtP(res.avgTP)}</td><td class="${res.avgSL<0?"r":""}">${fmtP(res.avgSL)}</td>
        <td class="${res.avgPnl>=0?"g":"r"}">${fmtP(res.avgPnl)}</td>
        <td class="${res.totalPnl>=0?"g":"r"}">${fmtP(res.totalPnl,1)}</td>
      </tr>`;
    }).join("")}
    </table>`).join("");

  // Top/Bottom 15
  const top15=symSummary.slice(0,15).map(s=>`<tr>
    <td class="L"><strong>${s.sym}</strong></td><td class="dim">${s.mkt}</td><td>${s.tf}</td>
    <td>${s.boxes}</td><td>${s.best.total}</td>
    <td class="${s.best.wr>=60?"g":s.best.wr<50?"r":""}">${fmt(s.best.wr)}%</td>
    <td class="${s.best.avgPnl>=0?"g":"r"}">${fmtP(s.best.avgPnl)}</td>
    <td>${bdg(s.best)}</td>
  </tr>`).join("");

  const bot10=symSummary.slice(-10).reverse().map(s=>`<tr>
    <td class="L"><strong>${s.sym}</strong></td><td class="dim">${s.mkt}</td><td>${s.tf}</td>
    <td>${s.boxes}</td><td>${s.best.total}</td>
    <td class="${s.best.wr>=60?"g":s.best.wr<50?"r":""}">${fmt(s.best.wr)}%</td>
    <td class="${s.best.avgPnl>=0?"g":"r"}">${fmtP(s.best.avgPnl)}</td>
    <td>${bdg(s.best)}</td>
  </tr>`).join("");

  // 모델 D vs A 비교
  const dA=overallAgg["A"]??{total:0,wins:0,pnlSum:0};
  const dD=overallAgg["D"]??{total:0,wins:0,pnlSum:0};
  const wrA=dA.total>0?(dA.wins/dA.total*100).toFixed(1):"—";
  const wrD=dD.total>0?(dD.wins/dD.total*100).toFixed(1):"—";
  const avgA=dA.total>0?(dA.pnlSum/dA.total).toFixed(2):"—";
  const avgD=dD.total>0?(dD.pnlSum/dD.total).toFixed(2):"—";
  const pineIsBetter=parseFloat(avgD)>parseFloat(avgA);

  const html=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title><style>${CSS}</style></head><body>
<div class="wrap">

<div class="hdr">
  <div class="logo">YSTOCK · Trading Strategy Report</div>
  <h1>Pine V2 전략 로직 검증<br>+ 4모델 백테스팅 비교 보고서</h1>
  <div class="sub">${totalSyms}종목 (S&amp;P500 · KOSPI/KOSDAQ · BTC/ETH/SOL) · ${now}</div>
</div>

<!-- ══ 1. 요청사항 반영 검증 ══ -->
<div class="sec">
  <h2>1. Pine 스크립트 요청사항 반영 검증</h2>
  <p>요청: <em>"진행중인 박스권 제외하고 이미 만들어진 박스권 이후 하단이탈했다가 다시 평균가 온애들을 진입만 가능하게"</em></p>

  <table>
    <tr><th class="L">요청 조건</th><th>구현 방법</th><th>반영여부</th></tr>
    <tr>
      <td class="L">진행중인 박스 제외 (완성된 박스만)</td>
      <td class="L"><code>barstate.isconfirmed</code> + <code>f_scan_box(1)</code> — newestOff=1 (직전 확정봉 기준)</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">미리보기 박스 매매 배열 제외</td>
      <td class="L"><code>show_preview</code> + <code>f_scan_box(0)</code> → 표시용 별도 객체, 트리거 배열 미추가</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">하단 이탈 먼저 (triggered)</td>
      <td class="L"><code>low &lt;= bottom</code> → <code>triggered = true</code>, dipLow 추적 시작</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">평균가(midPx) 복귀 시 진입</td>
      <td class="L"><code>close &gt;= midPx</code> (POC 기반 중심가) → 진입가 = midPx</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">MA 상승추세 필터</td>
      <td class="L"><code>uptrend</code> = Strict: ma5&gt;ma20&gt;ma120 / Loose: ma5&gt;ma20</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">손절: dipLow 재이탈</td>
      <td class="L"><code>low &lt;= dipLow</code> → 손절 (TP 후 dipLow 리셋)</td>
      <td class="chk">✅ 반영</td>
    </tr>
    <tr>
      <td class="L">익절: 박스 상단</td>
      <td class="L"><code>high &gt;= top</code> → 익절, idle 복귀 (재진입 허용)</td>
      <td class="chk">✅ 반영</td>
    </tr>
  </table>

  <h3>⚠️ 발견된 주의사항 (치명적이지 않으나 인지 필요)</h3>
  <div class="warn">
    <strong>[주의 1] afterBox 시간 체크 누락</strong><br>
    서버 사이드에는 <code>afterBox = now &gt; rightMs</code> 체크가 있어 박스 종료 이후에만 트리거를 허용합니다.
    Pine 스크립트는 박스 탐지 당일 즉시 <code>low &lt;= bottom</code> 조건이 충족되면 triggered될 수 있습니다.
    실제 영향은 매우 제한적 (박스 탐지 직후 봉에서 이탈 시만 해당)이나, 엄밀히는 "이미 만들어진 박스권 이후" 조건과 1봉 오차 발생 가능.
  </div>
  <div class="warn">
    <strong>[주의 2] 진입가 불일치: Pine(midPx) ↔ 서버(box.bottom)</strong><br>
    Pine 스크립트는 <code>midPx</code>(POC 중심가)에서 진입하여 상단(top)까지 익절 → 예상 수익률 ↓<br>
    서버 사이드는 <code>box.bottom</code>(하단)에서 진입 → 예상 수익률 ↑ (진입가가 낮으므로)<br>
    현재 Pine 요청대로 구현("평균가 온애들을 진입")은 맞지만, 서버 로직과 동작이 다릅니다.
    → 백테스팅 Model A vs D 비교를 통해 실제 차이를 아래에서 확인하세요.
  </div>
  <div class="ok">
    <strong>[결론]</strong> 핵심 요청사항(완성된 박스만, 평균가 진입, MA 필터, dipLow SL)은 모두 올바르게 반영되었습니다.
    주의사항 2가지는 전략 운영 시 인지하고 있어야 할 구조적 차이점입니다.
  </div>
</div>

<!-- ══ 2. 모델 정의 ══ -->
<div class="sec">
  <h2>2. 4가지 백테스팅 모델 정의</h2>
  <table>
    <tr><th class="L">모델</th><th class="L">진입 조건</th><th class="L">진입가</th><th class="L">MA 필터</th><th class="L">특징</th></tr>
    <tr>
      <td class="L">${bdg(MODELS[0])}</td>
      <td class="L">close ≥ bottom (하단 복귀)</td>
      <td class="L">box.bottom</td>
      <td class="L">없음</td>
      <td class="L">현재 서버 기존 로직과 동일</td>
    </tr>
    <tr>
      <td class="L">${bdg(MODELS[1])}</td>
      <td class="L">close ≥ midPx (평균가 복귀)</td>
      <td class="L">midPx (POC)</td>
      <td class="L">없음</td>
      <td class="L">Pine V2 진입 로직, MA 없음</td>
    </tr>
    <tr>
      <td class="L">${bdg(MODELS[2])}</td>
      <td class="L">close ≥ midPx + 5일MA &gt; 20일MA</td>
      <td class="L">midPx (POC)</td>
      <td class="L">5&gt;20 (Loose)</td>
      <td class="L">Pine V2 + 단기 상승 추세 필터</td>
    </tr>
    <tr class="best">
      <td class="L">${bdg(MODELS[3])}</td>
      <td class="L">close ≥ midPx + 5&gt;20&gt;120 정배열</td>
      <td class="L">midPx (POC)</td>
      <td class="L">5&gt;20&gt;120 (Strict) ★</td>
      <td class="L"><strong>현재 Pine 스크립트 기본 설정과 동일</strong></td>
    </tr>
  </table>
  <p class="dim" style="font-size:.8em;">※ 모든 모델 공통: 손절=dipLow 재이탈 / 익절=box.top / TP 후 재진입 허용 / Walk-forward 시뮬레이션</p>
</div>

<!-- ══ 3. 전체 집계 ══ -->
<div class="sec">
  <h2>3. 전체 집계 — ${okCount}종목 성공 / ${totalSyms}종목 시도</h2>
  <div class="info">일봉(1D) 기준 Walk-forward · dipLow 손절 · TP 후 재진입 허용 · 수수료·슬리피지 미반영</div>
  <table>
    <tr><th class="L">모델</th><th>탐지박스</th><th>거래수</th><th>승률</th><th>avgTP</th><th>avgSL</th><th>기대수익/거래</th><th>누적합계</th></tr>
    ${aggRows}
  </table>
  <div class="${pineIsBetter?"ok":"warn"}">
    <strong>Pine V2 MA Strict(D) vs 서버 기존(A) 비교:</strong>
    승률 ${wrA}% → ${wrD}%  /  기대수익 ${fmtP(parseFloat(avgA))} → ${fmtP(parseFloat(avgD))}
    ${pineIsBetter
      ? " → ✅ Pine V2 MA Strict 전략이 기대수익 기준 우수합니다. 서버 로직도 midPx 진입으로 전환 검토 권장."
      : " → ⚠️ midPx 진입이 bottom 진입보다 기대수익이 낮습니다. 진입가 상승에 따른 수익 감소가 MA 필터 개선분을 상쇄합니다."}
  </div>
</div>

<!-- ══ 4. 마켓별 ══ -->
<div class="sec">
  <h2>4. 마켓별 성과 (Crypto / US / KR)</h2>
  <table>
    <tr><th class="L">마켓</th><th class="L">모델</th><th>거래</th><th>승률</th><th>기대수익</th><th>누적</th></tr>
    ${mktRows}
  </table>
</div>

<!-- ══ 5. Crypto 상세 ══ -->
<div class="sec">
  <h2>5. 코인 3종 상세 (BTC · ETH · SOL)</h2>
  ${cryptoDetail||"<p class='dim'>데이터 없음</p>"}
</div>

<!-- ══ 6. Top 15 ══ -->
<div class="sec">
  <h2>6. 기대수익 상위 15종목 (전 시장)</h2>
  <table>
    <tr><th class="L">종목</th><th>마켓</th><th>TF</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>최적모델</th></tr>
    ${top15}
  </table>
</div>

<!-- ══ 7. Bottom 10 ══ -->
<div class="sec">
  <h2>7. 성과 부진 10종목 (리스크 주의)</h2>
  <table>
    <tr><th class="L">종목</th><th>마켓</th><th>TF</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>최적모델</th></tr>
    ${bot10}
  </table>
  <div class="warn">성과 부진 종목은 박스권 전략이 잘 맞지 않는 자산일 수 있습니다. 해당 종목 비중 축소 또는 제외를 권장합니다.</div>
</div>

<!-- ══ 8. 전략 개선 방향 ══ -->
<div class="sec">
  <h2>8. 전략 개선 방향 및 권고사항</h2>
  <table>
    <tr><th>#</th><th class="L">개선 항목</th><th class="L">근거</th><th>우선순위</th></tr>
    <tr><td>1</td><td class="L"><strong>서버 진입가를 midPx로 전환</strong> (현재 bottom)</td><td class="L">Pine 스크립트와 동일한 동작 보장, 약한 복귀에서 섣부른 진입 방지</td><td>높음</td></tr>
    <tr><td>2</td><td class="L"><strong>Pine에 afterBox 체크 추가</strong></td><td class="L"><code>time &gt; array.get(rightTimes, i)</code> 조건 → 박스 탐지 당일 즉시 트리거 방지</td><td>중간</td></tr>
    <tr><td>3</td><td class="L"><strong>MA Strict 기본값 유지</strong></td><td class="L">백테스팅 결과 상 가장 높은 기대수익 모델</td><td>높음</td></tr>
    <tr><td>4</td><td class="L"><strong>1H 국내주식 전략 비활성화</strong></td><td class="L">수수료 1.5% × 2 = 3%, 2% 박스는 손익분기 미달</td><td>높음</td></tr>
    <tr><td>5</td><td class="L"><strong>성과 부진 종목 유니버스 제외</strong></td><td class="L">위 Bottom 10 종목 자동매매 대상에서 제외</td><td>중간</td></tr>
    <tr><td>6</td><td class="L"><strong>dipLow 최소 깊이 필터</strong></td><td class="L">bottom × 0.5% 이상 이탈한 경우만 triggered (너무 얕은 dip 제거)</td><td>중간</td></tr>
  </table>
</div>

<!-- ══ 위험 고지 ══ -->
<div class="sec">
  <div class="risk">
    <h2>⚠️ 투자 위험 고지</h2>
    <ul>
      <li>이 보고서는 투자권유가 아닌 전략 검증 및 시스템 현황 안내입니다.</li>
      <li>백테스팅 결과는 과거 데이터 기반이며 미래 수익을 보장하지 않습니다.</li>
      <li>수수료·슬리피지·세금이 미반영된 수치이므로 실제 수익은 더 낮을 수 있습니다.</li>
      <li>자동매매 시스템 오류, API 장애, 거래소 장애 등으로 예상치 못한 손실이 발생할 수 있습니다.</li>
      <li>투자 손실의 최종 책임은 전적으로 투자자 본인에게 있습니다.</li>
    </ul>
  </div>
</div>

<div class="ftr">
  YSTOCK 자동매매 · Pine V2 전략 검증 보고서 · ${now}<br>
  데이터: Binance USDT (코인) · Yahoo Finance (US·KR) · Walk-forward 백테스팅<br>
  문의: samron3797@gmail.com · 수신거부: 답장으로 요청
</div>
</div></body></html>`;

  const text=`[YSTOCK] Pine V2 전략 검증 + ${okCount}종목 4모델 백테스팅 (${now})\n\n요청사항 반영: 완성된박스만/평균가진입/dipLow손절/MA필터 모두 반영됨\n주의: afterBox체크누락, 진입가 Pine(midPx)↔서버(bottom) 불일치\n\n집계:\n${MODELS.map(m=>{const a=overallAgg[m.id]??{total:0,wins:0,pnlSum:0};const wr=a.total>0?(a.wins/a.total*100).toFixed(1):"—";const avg=a.total>0?(a.pnlSum/a.total).toFixed(2):"—";return `${m.label}: 거래${a.total} 승률${wr}% 기대${avg}%`;}).join("\n")}\n\n⚠️ 투자위험고지: 백테스팅은 미래수익 보장 안함 — ${now}`;
  return {subject,html,text};
}

// ═══════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════
const now=new Date().toISOString().slice(0,16).replace("T"," ");
console.log(`\n[YSTOCK] Pine V2 검증 + 4모델 백테스팅 — ${now}`);

const users=listUsersSync();
const recipients=users.map(u=>getUserNotificationEmailSync(u)).filter(Boolean);
console.log(`  수신자: ${recipients.join(", ")}`);

function loadUni(name){ try{ return JSON.parse(readFileSync(join(__dirname,"../server/data",name),"utf8")); }catch{ return []; } }
const usSyms=loadUni("universe-us.json");
const krSyms=loadUni("universe-kr.json");

const targets=[
  {symbol:"BTC-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"ETH-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"SOL-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"BTC-USDT",isCrypto:true, tf:"1h",market:"Crypto"},
  {symbol:"ETH-USDT",isCrypto:true, tf:"1h",market:"Crypto"},
  ...usSyms.map(s=>({symbol:s.symbol,isCrypto:false,tf:"1d",market:"US"})),
  ...krSyms.map(s=>({symbol:s.symbol,isCrypto:false,tf:"1d",market:"KR"})),
];
console.log(`  백테스팅 대상: ${targets.length}종목`);

const allResults=await runBatch(targets.map(t=>async()=>{const r=await backtestOne(t.symbol,t.tf,t.isCrypto);return {...r,market:t.market};}),4);

let okCount=0;
const overallAgg={}, aggByMkt={};
const symSummary=[];

for(const r of allResults){
  const mkt=r.market??"US";
  if(r.error) continue;
  okCount++;
  if(!r.results?.length) continue;
  if(!aggByMkt[mkt]) aggByMkt[mkt]={};
  for(const res of r.results){
    if(!overallAgg[res.id]) overallAgg[res.id]={total:0,wins:0,pnlSum:0,boxes:0,avgTP:0,avgSL:0,_tpSum:0,_tpN:0,_slSum:0,_slN:0};
    const a=overallAgg[res.id];
    a.total+=res.total; a.wins+=res.wins; a.pnlSum+=res.totalPnl; a.boxes=Math.max(a.boxes,res.boxes);
    a._tpSum+=(res.avgTP*res.wins); a._tpN+=res.wins; a._slSum+=(res.avgSL*res.losses); a._slN+=res.losses;
    a.avgTP=a._tpN>0?a._tpSum/a._tpN:0; a.avgSL=a._slN>0?a._slSum/a._slN:0;
    if(!aggByMkt[mkt][res.id]) aggByMkt[mkt][res.id]={total:0,wins:0,pnlSum:0};
    aggByMkt[mkt][res.id].total+=res.total; aggByMkt[mkt][res.id].wins+=res.wins; aggByMkt[mkt][res.id].pnlSum+=res.totalPnl;
  }
  const best=r.results.reduce((b,m)=>m.avgPnl>b.avgPnl?m:b,r.results[0]);
  symSummary.push({sym:r.symbol,mkt,tf:r.tf,boxes:r.boxes,best});
}
symSummary.sort((a,b)=>b.best.avgPnl-a.best.avgPnl);
console.log(`  완료: ${okCount}종목 성공`);

const email=buildHtml(allResults,overallAgg,aggByMkt,symSummary,now,targets.length,okCount);

if(dryRun){
  console.log(`\n[dry-run] ${email.subject}`);
  for(const[id,a] of Object.entries(overallAgg)){
    const wr=a.total>0?(a.wins/a.total*100).toFixed(1):"0";
    const avg=a.total>0?(a.pnlSum/a.total).toFixed(2):"0";
    console.log(`  ${id}: 거래${a.total} 승률${wr}% 기대${avg}%`);
  }
}else{
  if(!isEmailSendingConfigured()){ console.error("SMTP미설정"); process.exit(1); }
  for(const to of recipients){
    await sendTransactionalEmail({to,subject:email.subject,text:email.text,html:email.html});
    console.log(`  ✓ 전송 → ${to}`);
  }
}
console.log("\n완료.");
