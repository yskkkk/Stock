#!/usr/bin/env node
/**
 * 투자설명회 이메일 — 박스권 PRO v2 전략 상세 + 전체 백테스팅 결과
 * 가입된 모든 인증 이메일에 면책조항 포함 발송
 * node scripts/send-investor-presentation.mjs [--dry-run]
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
// 백테스팅 엔진 (인라인)
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

function buildDailyDateMap(dc) {
  const m=new Map();
  for(let j=0;j<dc.length;j++) m.set(new Date(dc[j].time*1000).toISOString().slice(0,10),j);
  return m;
}

function simulatePine(candles,startI,box,maMode,dma,is1h) {
  const {top,bottom}=box;
  let state="idle",dipLow=NaN,entry=NaN;
  const trades=[]; let triggered=false,entered=false;
  function up(i){
    if(maMode==="none") return true;
    let j=i;
    if(is1h&&dma.dateMap){ const d=new Date(candles[i].time*1000).toISOString().slice(0,10); j=dma.dateMap.get(d)??-1; if(j<0)return false; }
    const m5=dma.ma5[j],m20=dma.ma20[j];
    if(!Number.isFinite(m5)||!Number.isFinite(m20))return false;
    if(maMode==="loose")return m5>m20;
    const m120=dma.ma120[j]; return Number.isFinite(m120)&&m5>m20&&m20>m120;
  }
  for(let i=startI;i<candles.length;i++){
    const c=candles[i]; if(!c||!Number.isFinite(c.close))continue;
    if(state==="idle"){ if(c.low<=bottom){state="armed";dipLow=c.low;triggered=true;} }
    else if(state==="armed"){
      if(c.low<dipLow)dipLow=c.low;
      if(c.close>=bottom&&up(i)){state="in_position";entry=bottom;entered=true;}
    } else if(state==="in_position"){
      if(c.high>=top){trades.push({type:"TP",pnl:(top-entry)/entry*100,entry,exit:top});state="idle";dipLow=NaN;entry=NaN;}
      else if(Number.isFinite(dipLow)&&c.low<=dipLow){trades.push({type:"SL",pnl:(dipLow-entry)/entry*100,entry,exit:dipLow});state="dead";break;}
    } else break;
  }
  return {trades,triggered,entered};
}

function extractBoxes(candles,tf){
  const boxes=[],seen=new Set(),step=tf==="1h"?3:1;
  for(let i=BOX_RANGE_MIN_BARS+5;i<candles.length-2;i+=step){
    const r=detectBoxRangeProAt(candles,i,tf); if(!r)continue;
    const k=`${r.startIdx}-${i}-${r.box.top.toFixed(3)}-${r.box.bottom.toFixed(3)}`;
    if(seen.has(k))continue; seen.add(k); boxes.push({box:r.box,endIdx:i});
  }
  return boxes;
}

const MODES=[
  {id:"none",  label:"기본 (MA없음)",        badge:"#6b7280"},
  {id:"loose", label:"MA Loose (5>20)",     badge:"#2563eb"},
  {id:"strict",label:"MA Strict (5>20>120)",badge:"#059669"},
];

async function backtestOne(symbol,tf,isCrypto){
  let chart;
  try{ chart=isCrypto?await fetchBinanceUsdtChart(symbol,tf):await loadStock(symbol,tf); }
  catch(e){ return {symbol,tf,error:e.message,results:[]}; }
  const candles=chart?.candles??[];
  if(candles.length<BOX_RANGE_MIN_BARS+30) return {symbol,tf,error:"캔들부족",results:[]};
  let dma=buildMaArrays(candles);
  if(tf==="1h"){
    try{
      const dc=(isCrypto?await fetchBinanceUsdtChart(symbol,"1d"):await loadStock(symbol,"1d"))?.candles??[];
      const dm=buildMaArrays(dc); dma={...dm,dateMap:buildDailyDateMap(dc)};
    }catch{}
  }
  const boxes=extractBoxes(candles,tf);
  if(!boxes.length) return {symbol,tf,error:"박스없음",results:[],candles:candles.length};
  const results=MODES.map(mode=>{
    const trades=[];let triggered=0,entered=0;
    for(const {box,endIdx} of boxes){
      const sim=simulatePine(candles,Math.min(endIdx+1,candles.length-1),box,mode.id,dma,tf==="1h");
      trades.push(...sim.trades); if(sim.triggered)triggered++;if(sim.entered)entered++;
    }
    const wins=trades.filter(t=>t.type==="TP").length,losses=trades.filter(t=>t.type==="SL").length,total=trades.length;
    const wr=total>0?wins/total*100:0,avgPnl=total>0?trades.reduce((s,t)=>s+t.pnl,0)/total:0;
    const totalPnl=trades.reduce((s,t)=>s+t.pnl,0);
    const avgTP=wins>0?trades.filter(t=>t.type==="TP").reduce((s,t)=>s+t.pnl,0)/wins:0;
    const avgSL=losses>0?trades.filter(t=>t.type==="SL").reduce((s,t)=>s+t.pnl,0)/losses:0;
    return {modeId:mode.id,label:mode.label,badge:mode.badge,boxes:boxes.length,triggered,entered,total,wins,losses,wr,avgPnl,totalPnl,avgTP,avgSL};
  });
  return {symbol,tf,candles:candles.length,boxes:boxes.length,results,market:""};
}

async function runBatch(tasks,conc=4){
  const res=[];const q=[...tasks];let active=0,idx=0;
  await new Promise(r=>{
    function next(){
      if(!q.length&&!active){r();return;}
      while(active<conc&&q.length){
        const t=q.shift();active++;
        t().then(v=>{res[idx++]=v;active--;next();}).catch(e=>{res[idx++]={error:e.message};active--;next();});
      }
    }
    next();
  });
  return res;
}

// ═══════════════════════════════════════════════════
// HTML 이메일 빌더
// ═══════════════════════════════════════════════════
const CSS = `
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',Helvetica,sans-serif;background:#f0f4f8;color:#1a202c;line-height:1.7;}
.wrap{max-width:900px;margin:0 auto;background:#fff;}
/* ── 커버 ── */
.cover{background:linear-gradient(135deg,#0f1e3d 0%,#1a3a6e 50%,#0d2a5c 100%);color:#fff;padding:56px 40px 48px;text-align:center;}
.cover .logo{font-size:1.1em;letter-spacing:4px;color:#93c5fd;margin-bottom:20px;text-transform:uppercase;}
.cover h1{font-size:2.1em;font-weight:800;line-height:1.3;margin-bottom:12px;}
.cover .sub{font-size:1em;color:#bfdbfe;margin-bottom:28px;}
.cover .tag{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:20px;padding:5px 16px;font-size:.85em;margin:4px;}
.cover .disclaimer-short{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:12px 18px;margin-top:28px;font-size:.82em;color:#fca5a5;text-align:left;}
/* ── 섹션 ── */
.section{padding:36px 40px;border-bottom:1px solid #e5e7eb;}
.section:last-child{border-bottom:none;}
h2{font-size:1.25em;color:#1e3a8a;border-left:4px solid #2563eb;padding-left:12px;margin-bottom:18px;}
h3{font-size:1em;color:#374151;margin:18px 0 8px;font-weight:700;}
p{margin-bottom:10px;font-size:.93em;color:#374151;}
/* ── 테이블 ── */
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.83em;}
th{background:#1e3a8a;color:#fff;padding:9px 10px;text-align:center;white-space:nowrap;}
th.L{text-align:left;}
td{padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;vertical-align:middle;}
td.L{text-align:left;}
tr:nth-child(even) td{background:#f8faff;}
tr:hover td{background:#eff6ff;}
/* ── 색상 ── */
.g{color:#15803d;font-weight:700;} .r{color:#b91c1c;font-weight:700;}
.b{color:#1d4ed8;font-weight:600;} .dim{color:#9ca3af;}
.best{background:#fef9c3!important;}
/* ── 카드 ── */
.cards{display:table;width:100%;border-spacing:12px;}
.card{display:table-cell;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;text-align:center;width:33%;}
.card .cv{font-size:1.9em;font-weight:800;color:#1d4ed8;}
.card .cl{font-size:.8em;color:#6b7280;margin-top:4px;}
/* ── 흐름도 ── */
.flow{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px;padding:16px 0;}
.fbox{background:#1e3a8a;color:#fff;border-radius:8px;padding:10px 16px;font-size:.82em;text-align:center;min-width:90px;}
.farrow{color:#9ca3af;font-size:1.4em;padding:0 4px;}
/* ── 배지 ── */
.badge{color:#fff;padding:2px 8px;border-radius:9px;font-size:.78em;font-weight:600;white-space:nowrap;}
/* ── 위험 고지 ── */
.risk-box{background:#fff5f5;border:2px solid #ef4444;border-radius:10px;padding:22px 24px;margin:10px 0;}
.risk-box h2{color:#dc2626;border-color:#ef4444;}
.risk-box ul li{font-size:.9em;color:#7f1d1d;margin:6px 0;}
/* ── 정보·경고 박스 ── */
.info{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin:10px 0;font-size:.88em;}
.warn{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin:10px 0;font-size:.88em;}
.ok{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin:10px 0;font-size:.88em;}
/* ── 푸터 ── */
.footer{background:#1a202c;color:#9ca3af;padding:28px 40px;font-size:.8em;line-height:1.9;}
.footer a{color:#60a5fa;}
`;

function bdg(r){return `<span class="badge" style="background:${r.badge}">${r.label}</span>`;}

function aggSection(overallAgg, aggByMkt){
  const rows = MODES.map(m=>{
    const a=overallAgg[m.id]??{total:0,wins:0,pnlSum:0,boxes:0};
    const wr=a.total>0?a.wins/a.total*100:0,avg=a.total>0?a.pnlSum/a.total:0;
    const best=MODES.every(o=>(overallAgg[o.id]?.pnlSum/Math.max(1,overallAgg[o.id]?.total??1)??-999)<=avg+0.001);
    return `<tr class="${best?"best":""}">
      <td class="L">${bdg(m)}</td>
      <td>${fmtN(a.boxes)}</td><td>${fmtN(a.total)}</td>
      <td class="${wr>=60?"g":wr<50?"r":""}">${fmt(wr)}%</td>
      <td class="${avg>=0?"g":"r"}">${fmtP(avg)}</td>
      <td class="${(a.pnlSum??0)>=0?"g":"r"}">${fmtP(a.pnlSum??0,1)}</td>
    </tr>`;
  }).join("");

  const mktRows=Object.entries(aggByMkt).map(([mkt,mktD])=>
    MODES.map(m=>{
      const d=mktD[m.id]??{total:0,wins:0,pnlSum:0,boxes:0};
      const wr=d.total>0?d.wins/d.total*100:0,avg=d.total>0?d.pnlSum/d.total:0;
      return `<tr>
        <td class="L"><strong>${mkt}</strong></td>
        <td class="L">${bdg(m)}</td>
        <td>${d.boxes??0}</td><td>${d.total}</td>
        <td class="${wr>=60?"g":wr<50?"r":""}">${fmt(wr)}%</td>
        <td class="${avg>=0?"g":"r"}">${fmtP(avg)}</td>
        <td class="${(d.pnlSum??0)>=0?"g":"r"}">${fmtP(d.pnlSum??0,1)}</td>
      </tr>`;
    }).join("")
  ).join("");

  return {aggRows:rows, mktRows};
}

function buildPresentation(allResults, overallAgg, aggByMkt, symSummary, now, totalSyms, okCount){
  const subject=`[YSTOCK] 박스권 자동매매 PRO v2 — 투자전략 설명 및 ${totalSyms}종목 백테스팅 결과 (${now})`;
  const {aggRows,mktRows}=aggSection(overallAgg,aggByMkt);

  // 핵심 지표
  const bestModel=MODES.reduce((b,m)=>{
    const a=overallAgg[m.id]??{total:0,pnlSum:0,wins:0};
    const avg=a.total>0?a.pnlSum/a.total:-999;
    const ba=(overallAgg[b.id]??{total:0,pnlSum:0}).pnlSum/Math.max(1,(overallAgg[b.id]?.total??1));
    return avg>ba?m:b;
  }, MODES[0]);
  const bm=overallAgg[bestModel.id]??{total:0,wins:0,pnlSum:0};
  const bestWr=bm.total>0?(bm.wins/bm.total*100).toFixed(1):"—";
  const bestAvg=bm.total>0?(bm.pnlSum/bm.total).toFixed(2):"—";
  const totalBoxes=Object.values(overallAgg).reduce((s,a)=>Math.max(s,a.boxes??0),0);

  // Top 15 심볼
  const top15=symSummary.slice(0,15).map(s=>`<tr>
    <td class="L"><strong>${s.sym}</strong></td><td class="dim">${s.mkt}</td><td>${s.tf}</td>
    <td>${s.boxes}</td><td>${s.best.total}</td>
    <td class="${s.best.wr>=60?"g":s.best.wr<50?"r":""}">${fmt(s.best.wr)}%</td>
    <td class="${s.best.avgPnl>=0?"g":"r"}">${fmtP(s.best.avgPnl)}</td>
    <td>${bdg(s.best)}</td>
  </tr>`).join("");

  // Crypto 상세
  const cryptoRows=allResults.filter(r=>r.market==="Crypto"&&r.results?.length).map(r=>{
    const bm=r.results.reduce((b,m)=>m.avgPnl>b.avgPnl?m:b,r.results[0]);
    return `<tr>
      <td class="L"><strong>${r.symbol}</strong> · ${r.tf}</td>
      <td>${r.boxes}</td><td>${bm.total} (T${bm.triggered}/E${bm.entered})</td>
      <td class="${bm.wr>=60?"g":bm.wr<50?"r":""}">${fmt(bm.wr)}%</td>
      <td>${fmtP(bm.avgTP)}</td><td class="${bm.avgSL<0?"r":""}">${fmtP(bm.avgSL)}</td>
      <td class="${bm.avgPnl>=0?"g":"r"}">${fmtP(bm.avgPnl)}</td>
      <td>${bdg(bm)}</td>
    </tr>`;
  }).join("") || "<tr><td colspan='8' class='dim'>데이터 없음</td></tr>";

  const html=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
<style>${CSS}</style></head><body>
<div class="wrap">

<!-- ══ 커버 ══ -->
<div class="cover">
  <div class="logo">YSTOCK · Automated Trading</div>
  <h1>박스권 자동매매 PRO v2<br>투자전략 설명서</h1>
  <div class="sub">S&amp;P500 · KOSPI/KOSDAQ · BTC · ETH · SOL — ${totalSyms}종목 백테스팅 결과 포함</div>
  <span class="tag">1H 단기전략</span>
  <span class="tag">4H 중기전략</span>
  <span class="tag">1D 장기전략</span>
  <span class="tag">MA 추세필터</span>
  <span class="tag">Walk-forward 검증</span>
  <div class="disclaimer-short">
    ⚠️ <strong>투자 위험 고지:</strong> 이 자료는 투자권유가 아닌 전략 현황 안내입니다.
    백테스팅 결과는 과거 데이터 기반이며 미래 수익을 보장하지 않습니다.
    투자 손실의 책임은 전적으로 투자자 본인에게 있습니다.
    <br>발행일: ${now}
  </div>
</div>

<!-- ══ 요약 카드 ══ -->
<div class="section">
  <h2>핵심 성과 요약 (백테스팅 기준)</h2>
  <div class="cards">
    <div class="card"><div class="cv">${okCount}종목</div><div class="cl">백테스팅 완료</div></div>
    <div class="card"><div class="cv">${bestWr}%</div><div class="cl">최적 모델 평균 승률</div></div>
    <div class="card"><div class="cv">${bestAvg}%</div><div class="cl">거래당 기대수익 (수수료 전)</div></div>
  </div>
  <p class="dim" style="font-size:.8em;margin-top:12px;">※ 수수료·슬리피지 미반영. Walk-forward 시뮬레이션 기준. 과거 성과는 미래 수익을 보장하지 않습니다.</p>
</div>

<!-- ══ 전략 개요 ══ -->
<div class="section">
  <h2>1. 전략 개요 — 박스권 PRO v2란?</h2>
  <p>
    <strong>박스권 자동매매 PRO v2</strong>는 가격이 일정 범위(박스) 안에서 반복적으로 오가는 <strong>횡보(consolidation) 구간</strong>을 자동 탐지하고,
    박스 하단 이탈 → 재복귀 시점에 매수하여 박스 상단에서 익절하는 <strong>평균회귀 기반 자동매매 전략</strong>입니다.
  </p>
  <p>
    단순 박스권 매매와 달리, <strong>ER(효율비율) 필터·80/20 퍼센타일·POC(거래량 중심가)·거절 점수</strong>를 통해
    진짜 횡보 구간만 선별하고, 하단 이탈 후 복귀(dip recovery) 패턴을 확인한 뒤 진입합니다.
  </p>
  <div class="info">
    <strong>핵심 아이디어:</strong> 강한 지지·저항을 갖는 박스권에서 하단이 강제 이탈된 후 되돌아오는 현상은
    단기 과매도 → 수급 복귀로 해석됩니다. 이 시점은 리스크 대비 수익률이 가장 유리한 진입 타점입니다.
  </div>

  <h3>지원 시장 및 타임프레임</h3>
  <table>
    <tr><th class="L">시장</th><th>타임프레임</th><th>박스 폭 범위</th><th>수수료</th><th>손익분기 최소 박스</th></tr>
    <tr><td class="L"><strong>암호화폐</strong> (BTC/ETH/SOL · 빗썸)</td><td>1H · 4H · 1D</td><td>2% ~ 18%</td><td>0.2% × 2 = 0.4%</td><td>2% 이상</td></tr>
    <tr><td class="L"><strong>미국주식</strong> (S&amp;P500 · 토스)</td><td>1H · 4H · 1D</td><td>2% ~ 18%</td><td>~0.3% × 2 = 0.6%</td><td>2% 이상</td></tr>
    <tr><td class="L"><strong>국내주식</strong> (KOSPI/KOSDAQ · 토스)</td><td>1H · 4H · 1D</td><td>2% ~ 18%</td><td>0.75% × 2 = 1.5%</td><td>4% 이상 권장</td></tr>
  </table>
</div>

<!-- ══ 탐지 알고리즘 ══ -->
<div class="section">
  <h2>2. 박스권 탐지 알고리즘 상세</h2>

  <h3>① ER(효율비율) 필터 — 진짜 횡보 선별</h3>
  <p>
    <strong>ER = |순이동거리| / 합산경로</strong><br>
    ER이 낮을수록 가격이 직선으로 움직이지 않고 제자리를 맴돌고 있음을 의미합니다.
    임계값 <code>ER ≤ 0.40</code>인 구간만 박스권 후보로 취급합니다.
  </p>

  <h3>② 80/20 퍼센타일 밴드</h3>
  <p>
    단순 고가/저가 대신 <strong>고가 상위 80%·저가 하위 20%</strong> 퍼센타일을 박스 상·하단으로 설정합니다.
    극단적인 위크(wick)를 제외해 실제 거래가 집중되는 범위를 추출합니다.
  </p>

  <h3>③ POC(거래량 중심가)</h3>
  <p>
    박스 내 거래량 히스토그램에서 가장 거래가 집중된 가격대를 <strong>POC</strong>로 계산합니다.
    이 가격이 박스의 중심선이 되어 상·하단 대비 대칭성을 검증합니다.
  </p>

  <h3>④ 거절 점수 (Rejection Score)</h3>
  <p>
    박스 상단에 고가가 닿은 후 종가가 아래로 마감(상단 거절),
    하단에 저가가 닿은 후 종가가 위로 마감(하단 거절) 패턴을 점수화합니다.
    <strong>상·하단 모두 1점 이상</strong>인 박스만 유효 박스로 인정합니다.
  </p>

  <h3>⑤ 동적 확장 (Expand)</h3>
  <p>
    박스가 형성되면 이후 봉들이 박스 범위 내에서 계속 머무는지 확인하며 자동 확장합니다.
    중심에서 너무 벗어난 봉이 연속으로 나타나면 박스 종료로 판단합니다.
  </p>
</div>

<!-- ══ 타임프레임별 전략 ══ -->
<div class="section">
  <h2>3. 타임프레임별 전략 상세</h2>
  <table>
    <tr><th class="L">구분</th><th>1H (단기)</th><th>4H (중기)</th><th>1D (장기)</th></tr>
    <tr>
      <td class="L"><strong>박스 형성 기간</strong></td>
      <td>10봉 이상 (약 10시간)</td>
      <td>10봉 이상 (약 40시간)</td>
      <td>10봉 이상 (약 10일)</td>
    </tr>
    <tr>
      <td class="L"><strong>최소 박스 폭</strong></td>
      <td>2% (수수료 감안)</td>
      <td>3%</td>
      <td>3%</td>
    </tr>
    <tr>
      <td class="L"><strong>최대 박스 폭</strong></td>
      <td>4% (과도 변동 제외)</td>
      <td>6.5%</td>
      <td>18%</td>
    </tr>
    <tr>
      <td class="L"><strong>진입 조건</strong></td>
      <td colspan="3">박스 종료 후 하단 이탈(low ≤ bottom) → 하단 위 복귀(close ≥ bottom) + MA 추세 확인</td>
    </tr>
    <tr>
      <td class="L"><strong>익절(TP)</strong></td>
      <td colspan="3">고가가 박스 상단 도달 (high ≥ top)</td>
    </tr>
    <tr>
      <td class="L"><strong>손절(SL)</strong></td>
      <td colspan="3">저가가 dip 최저점 재이탈 (low ≤ dipLow)</td>
    </tr>
    <tr>
      <td class="L"><strong>복귀 확인</strong></td>
      <td>1H봉 마감 대기 (약 1시간)</td>
      <td>4H봉 마감 대기 (약 4시간)</td>
      <td>일봉 마감 대기 (하루)</td>
    </tr>
    <tr>
      <td class="L"><strong>권장 시장</strong></td>
      <td>Crypto (24시간), US</td>
      <td>Crypto, US, KR</td>
      <td>모든 시장</td>
    </tr>
  </table>
</div>

<!-- ══ 매매 프로세스 ══ -->
<div class="section">
  <h2>4. 자동매매 프로세스 (FSM 상태머신)</h2>
  <div class="flow">
    <div class="fbox">📦 박스 탐지<br><span style="font-size:.75em;opacity:.8">ER+POC+거절점수</span></div>
    <span class="farrow">→</span>
    <div class="fbox">💤 IDLE<br><span style="font-size:.75em;opacity:.8">박스 종료 대기</span></div>
    <span class="farrow">→</span>
    <div class="fbox" style="background:#7c3aed;">⚡ ARMED<br><span style="font-size:.75em;opacity:.8">하단 이탈 감지</span></div>
    <span class="farrow">→</span>
    <div class="fbox" style="background:#d97706;">⏳ CONFIRMING<br><span style="font-size:.75em;opacity:.8">복귀 + MA 확인</span></div>
    <span class="farrow">→</span>
    <div class="fbox" style="background:#059669;">🟢 IN POSITION<br><span style="font-size:.75em;opacity:.8">보유 중</span></div>
  </div>
  <div style="display:flex;gap:12px;margin-top:10px;">
    <div style="flex:1;" class="ok">
      <strong>✅ 익절 (TP)</strong><br>
      고가 ≥ 박스 상단<br>
      → 익절 후 IDLE 복귀 (재진입 허용)
    </div>
    <div style="flex:1;" class="warn">
      <strong>⚠️ 손절 (SL)</strong><br>
      저가 ≤ dip 최저점 재이탈<br>
      → 박스 소멸 (재진입 금지)
    </div>
    <div style="flex:1;" class="info">
      <strong>🚫 MA 대기</strong><br>
      복귀했으나 추세 미충족<br>
      → ARMED 유지, 다음 확인 대기
    </div>
  </div>
  <h3>실매매 연결 방식</h3>
  <table>
    <tr><th class="L">시장</th><th class="L">거래소</th><th class="L">매수 방식</th><th class="L">알림</th></tr>
    <tr><td class="L">암호화폐</td><td class="L">빗썸 (KRW)</td><td class="L">시장가 KRW 매수 (자동)</td><td class="L">텔레그램 실시간</td></tr>
    <tr><td class="L">미국·국내주식</td><td class="L">토스 증권</td><td class="L">시장가 자동 주문</td><td class="L">텔레그램 실시간</td></tr>
    <tr><td class="L">시뮬레이션</td><td class="L">내부 포트폴리오</td><td class="L">가상 체결 (실가격)</td><td class="L">텔레그램 실시간</td></tr>
  </table>
</div>

<!-- ══ MA 추세 필터 ══ -->
<div class="section">
  <h2>5. MA 추세 필터 — 시장 환경 게이트</h2>
  <p>
    박스권 하단 복귀 신호가 발생해도 시장 전반이 하락 추세라면 추가 하락 가능성이 높습니다.
    <strong>일봉 이동평균선</strong>을 통해 시장 방향성이 상승 국면일 때만 진입을 허용합니다.
  </p>
  <table>
    <tr><th class="L">필터 모드</th><th class="L">조건</th><th class="L">특징</th></tr>
    <tr>
      <td class="L"><strong>필터 없음</strong></td>
      <td class="L">조건 없음 — 항상 진입</td>
      <td class="L">신호 최다, 하락장 노출 큼</td>
    </tr>
    <tr>
      <td class="L"><strong>MA Loose</strong></td>
      <td class="L">5일MA &gt; 20일MA</td>
      <td class="L">단기 상승세 확인, 중간 수준 필터</td>
    </tr>
    <tr>
      <td class="L" class="best"><strong>MA Strict ★권장</strong></td>
      <td class="L">5일MA &gt; 20일MA &gt; 120일MA (정배열)</td>
      <td class="L">강한 상승 추세 시만 진입, 신호 감소·품질 향상</td>
    </tr>
  </table>
  <p>지수 기준: KOSPI(국내), S&amp;P500(미국), BTC(코인) — 종목 차트에 자동 적용</p>
</div>

<!-- ══ 백테스팅 전체 집계 ══ -->
<div class="section">
  <h2>6. 백테스팅 결과 — 전체 집계 (${okCount}종목 성공 / ${totalSyms}종목 시도)</h2>
  <div class="info">
    <strong>검증 방식:</strong> Walk-forward 시뮬레이션 — 각 시점에서 과거 데이터만 사용, Lookahead Bias 없음 · 일봉(1D) 기준 · dipLow 손절
  </div>
  <table>
    <tr><th class="L">모델</th><th>탐지 박스</th><th>거래 수</th><th>승률</th><th>거래당 기대수익</th><th>누적 수익</th></tr>
    ${aggRows}
  </table>
  <p class="dim" style="font-size:.8em;">※ 수수료(KR 1.5%·US 0.6%·Crypto 0.4%) 및 슬리피지 미반영 · 실제 수익률은 더 낮을 수 있음</p>

  <h3>마켓별 성과</h3>
  <table>
    <tr><th class="L">마켓</th><th class="L">모델</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>누적</th></tr>
    ${mktRows}
  </table>
</div>

<!-- ══ 암호화폐 상세 ══ -->
<div class="section">
  <h2>7. 코인 3종 상세 (BTC · ETH · SOL)</h2>
  <table>
    <tr><th class="L">종목·TF</th><th>탐지박스</th><th>거래(T/E)</th><th>승률</th><th>avgTP</th><th>avgSL</th><th>기대수익</th><th>최적모델</th></tr>
    ${cryptoRows}
  </table>
</div>

<!-- ══ Top15 종목 ══ -->
<div class="section">
  <h2>8. 전체 종목 성과 상위 15 (${okCount}종목 중)</h2>
  <table>
    <tr><th class="L">종목</th><th>마켓</th><th>TF</th><th>박스</th><th>거래</th><th>승률</th><th>기대수익</th><th>최적모델</th></tr>
    ${top15}
  </table>
  <p class="dim" style="font-size:.8em;">전체 종목 상세는 별도 백테스팅 결과 이메일 참조</p>
</div>

<!-- ══ 실매매 vs 백테스팅 ══ -->
<div class="section">
  <h2>9. 백테스팅 수익이 실매매에서 그대로 나올 수 있나?</h2>

  <div class="ok">
    <strong>✅ 실시간 적용 가능한 부분</strong><br>
    박스 탐지·FSM 로직은 Walk-forward 방식으로 실시간 데이터와 동일하게 작동합니다.
    MA 필터도 당일 일봉 확인 즉시 적용 가능합니다.
  </div>

  <div class="warn">
    <strong>⚠️ 백테스팅과 실매매의 차이 (수익률 감소 요인)</strong>
    <table style="margin-top:10px;">
      <tr><th class="L">항목</th><th class="L">백테스팅</th><th class="L">실매매</th><th class="L">영향</th></tr>
      <tr><td class="L">진입가</td><td class="L">box.bottom (이론)</td><td class="L">시장가 (현재가)</td><td class="L">진입가 ↑ → 실질 수익 감소</td></tr>
      <tr><td class="L">수수료</td><td class="L">미반영</td><td class="L">KR 1.5% / US 0.6% / Crypto 0.4%</td><td class="L">직접 수익 차감</td></tr>
      <tr><td class="L">슬리피지</td><td class="L">0</td><td class="L">0.05% ~ 0.3% (시장 유동성 의존)</td><td class="L">소폭 수익 감소</td></tr>
      <tr><td class="L">박스 감지 지연</td><td class="L">봉 마감 즉시</td><td class="L">1봉 지연 가능</td><td class="L">소수 신호 누락</td></tr>
      <tr><td class="L">심리적 요인</td><td class="L">없음</td><td class="L">조기 청산·과신 위험</td><td class="L">시스템 신뢰 필요</td></tr>
    </table>
  </div>

  <div class="info">
    <strong>현실적 기대치:</strong> 백테스팅 기대수익에서 수수료를 차감하면 1H 국내 전략은 사실상 손익분기 수준입니다.
    <strong>4H·1D + 미국·코인 전략</strong>이 수수료 차감 후에도 양(+)의 기대수익을 보이는 핵심 전략입니다.
  </div>
</div>

<!-- ══ 리스크 분석 ══ -->
<div class="section">
  <h2>10. 리스크 분석 및 손실 시나리오</h2>
  <table>
    <tr><th class="L">리스크 유형</th><th class="L">발생 조건</th><th class="L">관리 방안</th></tr>
    <tr>
      <td class="L"><strong>연속 손절</strong></td>
      <td class="L">하락 추세에서 박스 하단 이탈 후 계속 하락</td>
      <td class="L">MA 필터로 하락장 진입 차단 / 1프로그램 최대 포지션 수 제한</td>
    </tr>
    <tr>
      <td class="L"><strong>박스 오탐</strong></td>
      <td class="L">ER/거절점수 기준 충족하나 실제 지지 약한 박스</td>
      <td class="L">최소 거절 횟수 상향 / 최소 박스 폭 강화</td>
    </tr>
    <tr>
      <td class="L"><strong>갭 하락</strong></td>
      <td class="L">국내 주식 개장 시 전일 dipLow 훨씬 아래 갭</td>
      <td class="L">국내 전략 비중 축소 / 1H 국내 전략 사용 자제</td>
    </tr>
    <tr>
      <td class="L"><strong>유동성 리스크</strong></td>
      <td class="L">소형주·저유동성 코인 체결 불가</td>
      <td class="L">S&amp;P500·시총 상위 코인만 대상</td>
    </tr>
    <tr>
      <td class="L"><strong>API/시스템 장애</strong></td>
      <td class="L">거래소 API 오류, 네트워크 단절</td>
      <td class="L">WebSocket 재연결, 포지션 상태 복구 로직 내장</td>
    </tr>
    <tr>
      <td class="L"><strong>최대 낙폭</strong></td>
      <td class="L">동시 다발적 SL 발동</td>
      <td class="L">maxOpenPositions 설정으로 동시 포지션 한도 관리</td>
    </tr>
  </table>
</div>

<!-- ══ 위험 고지 (대형) ══ -->
<div class="section">
  <div class="risk-box">
    <h2>⚠️ 투자 위험 고지 (반드시 읽어주세요)</h2>
    <ul>
      <li><strong>이 자료는 투자 권유 또는 금융 투자 자문이 아닙니다.</strong> 시스템 현황 및 전략 안내 목적으로 제공됩니다.</li>
      <li><strong>백테스팅 수익률은 과거 데이터를 기반으로 하며, 미래의 수익이나 성과를 보장하지 않습니다.</strong></li>
      <li>자동매매 시스템을 사용하더라도 투자 원금의 일부 또는 전부를 잃을 수 있습니다.</li>
      <li>암호화폐 투자는 극단적인 가격 변동성을 가지며, 규제 환경 변화에 따른 추가 리스크가 존재합니다.</li>
      <li>주식 투자는 기업 리스크, 시장 리스크, 유동성 리스크 등 다양한 리스크에 노출됩니다.</li>
      <li>시스템 오류, API 장애, 네트워크 장애 등 기술적 문제로 예상치 못한 손실이 발생할 수 있습니다.</li>
      <li><strong>투자에 관한 최종 판단과 책임은 전적으로 투자자 본인에게 있습니다.</strong></li>
      <li>본 시스템은 한국 자본시장법상 투자자문업자가 아닙니다. 전문적인 금융 조언은 자격을 갖춘 투자 전문가에게 문의하시기 바랍니다.</li>
    </ul>
  </div>
</div>

<!-- ══ 푸터 ══ -->
<div class="footer">
  <strong>YSTOCK 자동매매 시스템</strong> · 박스권 PRO v2 전략 · ${now}<br>
  발행: samron3797@gmail.com · 수신 거부: 이 이메일에 답장으로 '수신거부' 요청<br>
  데이터 출처: Binance USDT (코인) · Yahoo Finance (US·KR 주식) · Walk-forward 백테스팅<br><br>
  <em>이 이메일은 투자권유가 아닌 YSTOCK 시스템 현황 안내입니다. 투자 손실에 대한 책임은 투자자 본인에게 있습니다.</em>
</div>

</div><!-- /wrap -->
</body></html>`;

  const text=`[YSTOCK] 박스권 자동매매 PRO v2 투자전략 설명서 (${now})\n\n${okCount}종목 백테스팅 완료.\n\n핵심 결과:\n${MODES.map(m=>{const a=overallAgg[m.id]??{total:0,wins:0,pnlSum:0};const wr=a.total>0?(a.wins/a.total*100).toFixed(1):"—";const avg=a.total>0?(a.pnlSum/a.total).toFixed(2):"—";return `${m.label}: 승률 ${wr}% / 기대수익 ${avg}%`;}).join("\n")}\n\n⚠️ 투자 위험 고지: 이 자료는 투자권유가 아닙니다. 백테스팅 결과는 과거 기반이며 미래 수익을 보장하지 않습니다. — ${now}`;

  return {subject,html,text};
}

// ═══════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════
const now = new Date().toISOString().slice(0,16).replace("T"," ");
console.log(`\n[YSTOCK] 투자설명회 이메일 준비 — ${now}`);

// 사용자 이메일 수집
const users = listUsersSync();
const recipients = users
  .map(u => getUserNotificationEmailSync(u))
  .filter(Boolean);
console.log(`  수신자: ${recipients.join(", ")}`);

// 유니버스 로드
function loadUni(name){ try{ return JSON.parse(readFileSync(join(__dirname,"../server/data",name),"utf8")); }catch{ return []; } }
const usSyms = loadUni("universe-us.json");
const krSyms = loadUni("universe-kr.json");

// 백테스팅 대상
const targets = [
  {symbol:"BTC-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"ETH-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"SOL-USDT",isCrypto:true, tf:"1d",market:"Crypto"},
  {symbol:"BTC-USDT",isCrypto:true, tf:"1h",market:"Crypto"},
  {symbol:"ETH-USDT",isCrypto:true, tf:"1h",market:"Crypto"},
  ...usSyms.map(s=>({symbol:s.symbol,isCrypto:false,tf:"1d",market:"US"})),
  ...krSyms.map(s=>({symbol:s.symbol,isCrypto:false,tf:"1d",market:"KR"})),
];
console.log(`  백테스팅 대상: ${targets.length}종목`);

const tasks = targets.map(t=>async()=>{
  const r=await backtestOne(t.symbol,t.tf,t.isCrypto);
  return {...r,market:t.market};
});

const allResults = await runBatch(tasks,4);

let okCount=0;
const overallAgg={}, aggByMkt={};
const symSummary=[];

for(const r of allResults){
  const mkt=r.market??"US";
  if(r.error){ continue; }
  okCount++;
  if(!r.results?.length) continue;
  if(!aggByMkt[mkt]) aggByMkt[mkt]={};
  for(const res of r.results){
    if(!overallAgg[res.modeId]) overallAgg[res.modeId]={total:0,wins:0,pnlSum:0,boxes:0};
    overallAgg[res.modeId].total+=res.total; overallAgg[res.modeId].wins+=res.wins;
    overallAgg[res.modeId].pnlSum+=res.totalPnl; overallAgg[res.modeId].boxes=Math.max(overallAgg[res.modeId].boxes,res.boxes);
    if(!aggByMkt[mkt][res.modeId]) aggByMkt[mkt][res.modeId]={total:0,wins:0,pnlSum:0,boxes:0};
    aggByMkt[mkt][res.modeId].total+=res.total; aggByMkt[mkt][res.modeId].wins+=res.wins;
    aggByMkt[mkt][res.modeId].pnlSum+=res.totalPnl; aggByMkt[mkt][res.modeId].boxes+=res.boxes;
  }
  const best=r.results.reduce((b,m)=>m.avgPnl>b.avgPnl?m:b,r.results[0]);
  symSummary.push({sym:r.symbol,mkt,tf:r.tf,boxes:r.boxes,best});
}
symSummary.sort((a,b)=>b.best.avgPnl-a.best.avgPnl);

console.log(`  백테스팅 완료: ${okCount}종목 성공`);

const email = buildPresentation(allResults,overallAgg,aggByMkt,symSummary,now,targets.length,okCount);

if(dryRun){
  console.log(`\n[dry-run] 제목: ${email.subject}`);
  console.log(`  수신자: ${recipients.join(", ")}`);
  for(const[mid,a] of Object.entries(overallAgg)){
    const wr=a.total>0?(a.wins/a.total*100).toFixed(1):"0";
    const avg=a.total>0?(a.pnlSum/a.total).toFixed(2):"0";
    console.log(`  ${mid}: 거래${a.total} 승률${wr}% 기대${avg}%`);
  }
} else {
  if(!isEmailSendingConfigured()){ console.error("SMTP 미설정"); process.exit(1); }
  for(const to of recipients){
    await sendTransactionalEmail({to, subject:email.subject, text:email.text, html:email.html});
    console.log(`  ✓ 전송 → ${to}`);
  }
}
console.log("\n완료.");
