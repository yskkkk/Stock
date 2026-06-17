#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import nodemailer from "nodemailer";
import { resolveMailFrom } from "../server/email-sender.js";
loadEnvFile();

const to = "samron3@naver.com";
const now = new Date().toLocaleDateString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});

// ─── 버그 목록 ────────────────────────────────────────────────────────────
const bugs = [
  // ── SECTION 1: 매매 실행 (runner-fsm / ws-fsm) ──
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🔴 HIGH",
    title:"매도 중복 실행 방어 없음",
    file:"runner-fsm.js — in_position 블록",
    detail:"매수는 <code>boxBuyInFlight</code> Set으로 동시 중복을 차단하지만 매도에 동등한 guard가 없습니다. WebSocket 틱(ws-fsm)과 3초 폴러(runner.js)가 거의 동시에 같은 박스의 TP/SL 도달을 감지하면, 두 경로 모두 동일 수량으로 매도 주문 2회 전송.",
    fix:"<code>boxSellInFlight</code> Set 추가 또는 매도 직전 box state를 임시 'closing'으로 패치(낙관적 잠금)."
  },
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🟡 MEDIUM",
    title:"sim · crypto live 매수 시 targets(익절/손절) 포트폴리오 미기록",
    file:"runner-fsm.js:148, :191",
    detail:"<b>sim 자동매수(line 191)</b> · <b>live crypto 매수(line 148)</b> 모두 <code>recordLiveTradeBuyAsync</code>에 <code>targets</code> 인자를 전달하지 않습니다. Live US/KR 매수(line 162)만 <code>recordLiveTradeBuySync(..., targets, orderAmount)</code>로 올바르게 전달. targets 포함 정보: targetSellPrice(익절), stopLossPrice(손절), entryKind.",
    fix:"sim · crypto 매수 경로에도 <code>targets</code> 객체를 4번째 인자로 전달."
  },
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🟡 MEDIUM",
    title:"maxOpenPositions 미설정 시 포지션 무제한 진입",
    file:"runner-fsm.js:114–115",
    detail:"<code>openLots >= program.maxOpenPositions</code>에서 maxOpenPositions이 null/undefined이면 <code>number >= undefined → false</code>(JS 동작)로 제한이 전혀 없습니다.",
    fix:"<code>const max = Number(program.maxOpenPositions); if (!Number.isFinite(max) || max &lt;= 0 || openLots >= max) return;</code>"
  },
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🟠 LOW-MEDIUM",
    title:"텔레그램 중심가 알림 이중 발송 가능",
    file:"runner-fsm.js:102–110",
    detail:"<code>midNotifiedAtMs</code> null 확인 → 알림 발송 → <code>patchBoxSync</code>(파일 I/O) 순서. ws-fsm과 폴러가 동시에 같은 박스를 처리하면 둘 다 null 확인 → 알림 2회 발송. 이중 매수는 <code>boxBuyInFlight</code>가 막지만 알림은 막지 못함.",
    fix:"알림 발송 전 <code>boxNotifyInFlight</code> Set으로 차단, 또는 <code>patchBoxSync</code>를 알림보다 먼저 실행."
  },
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🔵 LOW",
    title:"ws-fsm: crypto 전용 시세 조회 하드코딩",
    file:"ws-fsm.js:69",
    detail:"<code>pickQuoteFromMap(quotes, sym, \"crypto\")</code> 하드코딩. 현재 ws-fsm은 crypto 전용이라 무해하지만 향후 US/KR WebSocket FSM 추가 시 시세 조회가 crypto 경로로 고정되어 실패.",
    fix:"market을 box 또는 program에서 동적으로 전달."
  },
  {
    section:"매매 실행 (runner-fsm.js · ws-fsm.js)",
    sev:"🔵 LOW",
    title:"ws-fsm: tradeEligible 미필터 후 FSM 호출",
    file:"ws-fsm.js:81–84",
    detail:"closed 체크만 있고 tradeEligible 체크 없이 processBoxFsmForProgram 호출. FSM 내부 첫 줄에서 처리하므로 결과는 동일하지만, WebSocket 틱마다 불필요한 함수 호출 발생.",
    fix:"<code>if (box.state === \"closed\" || box.tradeEligible === false) continue;</code>"
  },
  // ── SECTION 2: 빗썸 어댑터 ──
  {
    section:"빗썸 어댑터 (bithumb-trading-adapter.js)",
    sev:"🔴 HIGH",
    title:"분할 매도 시 fillVolume null → 체결량 오류",
    file:"bithumb-trading-adapter.js:537, :562",
    detail:"분할 매도 1차: <code>let totalSold = Number(first.fillVolume) || sellVolume;</code><br>2차: <code>totalSold += Number(second.fillVolume) || rem;</code><br>fillVolume이 undefined이면 <code>Number(undefined) = NaN</code> → OR 연산으로 sellVolume/rem으로 폴백. 실제 체결량 대신 요청량이 기록됨.",
    fix:"<code>Number(x ?? 0)</code> 또는 <code>typeof x === 'number' && x > 0 ? x : fallback</code> 패턴으로 명시적 처리."
  },
  {
    section:"빗썸 어댑터 (bithumb-trading-adapter.js)",
    sev:"🟡 MEDIUM",
    title:"장부 차감 후 주문 실패 시 롤백 없음",
    file:"bithumb-trading-adapter.js:529",
    detail:"<code>deductBithumbLedgerAvailable(userId, base, sellVolume)</code> — 동기 장부 차감 후 <code>await marketSellOnce(...)</code> 실패 시 롤백 로직 없음. 라인 569의 <code>refreshBithumbLedgerForUser</code>는 성공 경로에서만 호출.",
    fix:"주문 실패 시 <code>refreshBithumbLedgerForUser</code>를 finally에서 항상 호출하여 장부를 실제 빗썸 잔고와 재동기화."
  },
  // ── SECTION 3: 포트폴리오 스토어 ──
  {
    section:"포트폴리오 스토어 (live-trade-portfolio-store.js)",
    sev:"🔴 HIGH",
    title:"FX 환율 조회 실패 시 orderAmount undefined 전달 가능",
    file:"live-trade-market.js:84–98",
    detail:"<code>resolveOrderAmountForMarket</code>에서 FX 환율 조회(getUsdKrwRate) 실패 시 catch 블록이 <code>return</code> 없이 종료 → undefined 반환 가능. 이후 <code>assertMinCryptoOrderAmountKrw(market, undefined)</code> 또는 undefined orderAmount로 매수 기록.",
    fix:"catch 블록에서 반드시 <code>return program.orderAmountKrw ?? 0</code> 폴백 반환."
  },
  {
    section:"포트폴리오 스토어 (live-trade-portfolio-store.js)",
    sev:"🟡 MEDIUM",
    title:"부분 매도 시 proportionalFee 계산 — 원거래 수량 0이면 NaN",
    file:"live-trade-portfolio-store.js:417",
    detail:"<code>proportionalFee = (t.feeAmount / t.quantity) * sellQty</code><br>원거래 quantity가 0이면 Infinity 또는 NaN → realizedPnl 오염.",
    fix:"<code>t.quantity > 1e-12</code> 가드 추가."
  },
  {
    section:"포트폴리오 스토어 (live-trade-portfolio-store.js)",
    sev:"🟡 MEDIUM",
    title:"avgEntry 0 근처 부동소수점 오차 → 손익 계산 왜곡",
    file:"live-trade-portfolio-store.js:682–685",
    detail:"<code>avgEntry = pos.costBasis / pos.quantity</code> — costBasis가 부동소수점 누적 오차로 거의 0에 근접하면, 매도 기록의 entryPrice가 거의 0으로 저장 → 손익률 수백 % 오류.",
    fix:"<code>avgEntry > 1e-6</code> 조건 체크 후 유효하지 않으면 별도 기록 처리."
  },
  // ── SECTION 4: Lot 조정 ──
  {
    section:"Lot 조정 (lot-reconcile.js)",
    sev:"🟡 MEDIUM",
    title:"매도 체결 boxId null인 경우 open lot 과다 집계",
    file:"lot-reconcile.js:48",
    detail:"<code>resolveBoxOpenLotFromTrades</code>의 매도 합산: <code>t.side === 'sell' && t.programId === pid && t.boxId === boxId && t.atMs >= buy.atMs</code><br>boxId가 설정된 매도 체결만 집계. 구버전 또는 수동 매도로 <code>boxId = null</code>인 sell trade는 합산에서 제외 → 잔여 수량 과다 집계 → 불필요한 재매수 시도.",
    fix:"boxId가 null인 sell trade도 programId + symbol + atMs 조건으로 포함하거나, boxId=null sell trade를 명시적으로 경고."
  },
  // ── SECTION 5: 토스 어댑터 ──
  {
    section:"토스 어댑터 (toss-trading-adapter.js)",
    sev:"🟡 MEDIUM",
    title:"orderAmount null/undefined 시 API 오류 — 기록 미생성",
    file:"toss-trading-adapter.js:230–234",
    detail:"<code>amount: program.orderAmountUsd</code>가 null이면 토스 API가 오류 반환. <code>executeLiveBuyOrder</code>는 out.ok = false를 반환하고, runner-fsm이 throw해서 포트폴리오 기록 없이 종료.",
    fix:"amount 유효성 검증을 orderAmount 조회 단계에서 선행 처리."
  },
];

// ─── HTML 생성 ─────────────────────────────────────────────────────────────
const sevColor={"🔴 HIGH":"#dc2626","🟡 MEDIUM":"#d97706","🟠 LOW-MEDIUM":"#ea580c","🔵 LOW":"#2563eb"};
const sevBg={"🔴 HIGH":"#fef2f2","🟡 MEDIUM":"#fffbeb","🟠 LOW-MEDIUM":"#fff7ed","🔵 LOW":"#eff6ff"};
const sevBorder={"🔴 HIGH":"#fecaca","🟡 MEDIUM":"#fde68a","🟠 LOW-MEDIUM":"#fed7aa","🔵 LOW":"#bfdbfe"};

const sections=[...new Set(bugs.map(b=>b.section))];

const high=bugs.filter(b=>b.sev==="🔴 HIGH").length;
const med=bugs.filter(b=>b.sev==="🟡 MEDIUM").length;
const lowMed=bugs.filter(b=>b.sev==="🟠 LOW-MEDIUM").length;
const low=bugs.filter(b=>b.sev==="🔵 LOW").length;

const summaryHtml=`
<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:0.9em;">
<tr>
  <td style="padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;text-align:center;width:25%"><div style="font-size:1.3em;font-weight:700;color:#dc2626">${high}</div><div style="color:#7f1d1d;font-size:0.82em;margin-top:2px">🔴 HIGH</div></td>
  <td style="width:2%;"></td>
  <td style="padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;text-align:center;width:25%"><div style="font-size:1.3em;font-weight:700;color:#d97706">${med}</div><div style="color:#78350f;font-size:0.82em;margin-top:2px">🟡 MEDIUM</div></td>
  <td style="width:2%;"></td>
  <td style="padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;text-align:center;width:25%"><div style="font-size:1.3em;font-weight:700;color:#ea580c">${lowMed}</div><div style="color:#7c2d12;font-size:0.82em;margin-top:2px">🟠 LOW-MED</div></td>
  <td style="width:2%;"></td>
  <td style="padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;text-align:center;width:25%"><div style="font-size:1.3em;font-weight:700;color:#2563eb">${low}</div><div style="color:#1e3a8a;font-size:0.82em;margin-top:2px">🔵 LOW</div></td>
</tr>
</table>`;

let bugNo=0;
const sectionsHtml=sections.map(sec=>{
  const secBugs=bugs.filter(b=>b.section===sec);
  const cards=secBugs.map(b=>{
    bugNo++;
    const c=sevColor[b.sev]??"#333";
    const bg=sevBg[b.sev]??"#f8fafc";
    const br=sevBorder[b.sev]??"#e2e8f0";
    return `<div style="border:1px solid ${br};border-radius:8px;padding:16px 18px;margin-bottom:14px;background:${bg};">
  <div style="margin-bottom:8px;">
    <span style="font-weight:700;color:${c};font-size:0.95em;">${b.sev}</span>
    <span style="font-weight:700;font-size:0.95em;margin-left:8px;">#${bugNo} ${b.title}</span>
  </div>
  <div style="font-size:0.8em;color:#64748b;font-family:monospace;margin-bottom:9px;">📁 ${b.file}</div>
  <div style="font-size:0.87em;line-height:1.75;margin-bottom:10px;">${b.detail}</div>
  <div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:7px 12px;font-size:0.85em;border-radius:0 4px 4px 0;">
    <strong>수정 방향:</strong> ${b.fix}
  </div>
</div>`;
  }).join("");
  return `<h2 style="font-size:1.0em;margin:26px 0 10px;color:#1e3a8a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  ${sec}
</h2>${cards}`;
}).join("");

// 이미 수정된 항목
const fixedHtml=`
<h2 style="font-size:1.0em;margin:26px 0 10px;color:#15803d;border-bottom:2px solid #d1fae5;padding-bottom:6px;">
  ✅ 이번 세션에서 수정 완료
</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.86em;">
<thead><tr style="background:#d1fae5;"><th style="padding:6px 10px;text-align:left;">파일</th><th style="padding:6px 10px;text-align:left;">내용</th></tr></thead>
<tbody>
<tr><td style="padding:5px 10px;font-family:monospace;">detect-pro.js</td><td style="padding:5px 10px;">leftTime/rightTime 역전 — 박스 병합 완전 불능 수정</td></tr>
<tr style="background:#ecfdf5;"><td style="padding:5px 10px;font-family:monospace;">sp500-scan-runner.js</td><td style="padding:5px 10px;">slice(0,-1) 이중 제거 — 최신 확정봉 누락 수정</td></tr>
<tr><td style="padding:5px 10px;font-family:monospace;">runner.js</td><td style="padding:5px 10px;">동일 slice 버그 수정</td></tr>
<tr style="background:#ecfdf5;"><td style="padding:5px 10px;font-family:monospace;">chart-overlay.js</td><td style="padding:5px 10px;">동일 slice 버그 수정</td></tr>
<tr><td style="padding:5px 10px;font-family:monospace;">catalog-trading-sync.js</td><td style="padding:5px 10px;">linkedIds closed 박스 포함 + dead code hasTf 블록 수정</td></tr>
<tr style="background:#ecfdf5;"><td style="padding:5px 10px;font-family:monospace;">quotes.js</td><td style="padding:5px 10px;">isBoxRangeQuoteFresh — 타임스탬프 없을 때 true→false 수정</td></tr>
</tbody></table>`;

const html=`<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>[YSTOCK] 전체 버그 리포트</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#1a1a1a;max-width:860px;margin:0 auto;padding:28px;">

<h1 style="font-size:1.2em;border-bottom:3px solid #dc2626;padding-bottom:8px;color:#7f1d1d;">
  🐛 매매·서버 전체 버그 리포트
</h1>
<p style="color:#64748b;font-size:0.88em;">생성: ${now} · 총 ${bugs.length}건 미수정</p>

${summaryHtml}

${sectionsHtml}

<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
${fixedHtml}

<p style="margin-top:24px;font-size:0.8em;color:#94a3b8;">YSTOCK 자동 분석 보고서 · ${now}</p>
</body></html>`;

// text
const text=bugs.map((b,i)=>`#${i+1} [${b.sev.replace(/[^\w ]/g,"")}] ${b.title}\n파일: ${b.file}\n`).join("\n");

const host=String(process.env.SMTP_HOST??"").trim();
if(!host){console.error("SMTP 없음");process.exit(1);}
const port=Number(process.env.SMTP_PORT??587);
const from=resolveMailFrom();
const t=nodemailer.createTransport({host,port:Number.isFinite(port)?port:587,secure:process.env.SMTP_SECURE==="1"||port===465,auth:(()=>{const u=String(process.env.SMTP_USER??"").trim();return u?{user:u,pass:String(process.env.SMTP_PASS??"")}:undefined;})()});
await t.sendMail({
  from:{name:from.name,address:from.address},to,
  subject:`[YSTOCK] 전체 버그 리포트 — ${bugs.length}건 미수정 (HIGH ${high}건 포함)`,
  text,html,
});
console.log("발송 완료 →", to);
