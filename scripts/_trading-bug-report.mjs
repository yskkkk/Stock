#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import nodemailer from "nodemailer";
import { resolveMailFrom } from "../server/email-sender.js";
loadEnvFile();

const to = "samron3@naver.com";

const now = new Date().toLocaleDateString("ko-KR", {
  year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
});

const bugs = [
  {
    sev:"🔴 HIGH",
    title:"매도 중복 실행 방어 없음",
    file:"runner-fsm.js (in_position 블록)",
    detail:`매수는 <code>boxBuyInFlight</code> Set으로 동시 중복 실행을 차단하지만,<br>
매도에는 동등한 guard가 없습니다.<br><br>
<b>시나리오</b>: WebSocket 틱(ws-fsm.js)과 3초 폴러(runner.js)가 거의 동시에 같은 박스의 가격이 TP/SL에 닿은 걸 확인하면,<br>
두 경로 모두 <code>resolveBoxSellQuantitySync</code>로 동일한 수량을 읽고 → 매도 주문 2회 전송.<br><br>
<b>영향</b>: 실매매(live) 빗썸·토스 양쪽에서 동일 수량 중복 매도 → 초과 매도 발생 가능.`,
    fix:`<code>boxBuyInFlight</code>와 동일하게 <code>boxSellInFlight</code> Set을 추가하거나,<br>
매도 진입 전 state를 먼저 "closing" 임시 상태로 패치하는 낙관적 잠금 적용.`
  },
  {
    sev:"🟡 MEDIUM",
    title:"sim·crypto 매수 시 targets(익절/손절) 포트폴리오 미기록",
    file:"runner-fsm.js:190, :144",
    detail:`<b>sim 자동매수</b> (line 191):<br>
<code>recordLiveTradeBuyAsync(program, pick, { simulated: true, ...boxMeta })</code><br>
→ <code>targets</code> 누락<br><br>
<b>live crypto 매수</b> (line 148):<br>
<code>recordLiveTradeBuyAsync(program, {...}, { simulated, orderId, fillVolume, ...boxMeta })</code><br>
→ <code>targets</code> 누락<br><br>
<b>live US/KR 매수</b> (line 162)는 정상:<br>
<code>recordLiveTradeBuySync(program, pick, boxMeta, <b>targets</b>, orderAmount)</code><br><br>
<b>targets 내용</b>: targetSellPrice(익절), stopLossPrice(손절), entryKind, exitScenarioNote<br><br>
<b>영향</b>: sim 전체 + 실매매 빗썸 체결의 포트폴리오 레코드에 익절/손절 예상가 없음 → 거래내역 화면 TP/SL 미표시.`,
    fix:`sim 매수와 live crypto 매수 시 <code>recordLiveTradeBuyAsync</code> 4번째 인자로 <code>targets</code> 전달.`
  },
  {
    sev:"🟡 MEDIUM",
    title:"maxOpenPositions 미설정 시 포지션 무제한 진입",
    file:"runner-fsm.js:114–115",
    detail:`<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.85em;">const openLots = countOpenBoxLotsSync(program.id);
if (openLots >= program.maxOpenPositions) return;</pre>
<code>program.maxOpenPositions</code>가 <code>null</code> 또는 <code>undefined</code>이면<br>
<code>number >= undefined</code> → <code>false</code> (JS 동작) → 제한 없이 매수 진행.<br><br>
<b>영향</b>: 프로그램 생성 시 maxOpenPositions 미설정이면 박스마다 무제한 동시 진입.`,
    fix:`<code>const max = Number(program.maxOpenPositions);</code><br>
<code>if (!Number.isFinite(max) || max <= 0 || openLots >= max) return;</code>`
  },
  {
    sev:"🟠 LOW-MEDIUM",
    title:"텔레그램 중심가 알림 이중 발송 가능",
    file:"runner-fsm.js:102–110",
    detail:`<code>midNotifiedAtMs</code> null 체크 → 알림 발송 → <code>patchBoxSync</code> 순서인데,<br>
<code>patchBoxSync</code>는 파일 I/O라 수십 ms 걸립니다.<br><br>
ws-fsm(WebSocket) + runner 폴러가 동시에 같은 박스를 처리하면:<br>
둘 다 <code>midNotifiedAtMs === null</code> 확인 → 둘 다 알림 발송.<br><br>
<b>영향</b>: 같은 박스에 텔레그램 알림 2회 전송(매수는 <code>boxBuyInFlight</code>가 막음).`,
    fix:`알림 발송 전 <code>boxBuyInFlight</code>처럼 <code>boxNotifyInFlight</code> Set으로 동시 알림 차단,<br>또는 <code>patchBoxSync</code>를 알림 발송 이전에 먼저 실행.`
  },
  {
    sev:"🔵 LOW",
    title:"ws-fsm: crypto 전용 시세 조회 하드코딩",
    file:"ws-fsm.js:69",
    detail:`<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.85em;">const q = pickQuoteFromMap(quotes, sym, "crypto");</pre>
ws-fsm은 현재 crypto 전용이므로 실제 문제 없음.<br>
향후 US/KR WebSocket 실시간 FSM 추가 시 시세 조회가 crypto 경로로 고정되어 실패.`,
    fix:`market을 박스 또는 프로그램에서 읽어 동적으로 전달.`
  },
  {
    sev:"🔵 LOW",
    title:"ws-fsm: tradeEligible 미필터 후 FSM 호출",
    file:"ws-fsm.js:81–84",
    detail:`<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.85em;">for (const box of boxes) {
  if (box.state === "closed") continue;  // tradeEligible 체크 없음
  await processBoxFsmForProgram(...);</pre>
FSM 내부 첫 줄에서 <code>tradeEligible === false</code> 시 즉시 return하므로 결과는 동일.<br>
불필요한 FSM 호출만 발생 (WebSocket 틱마다).`,
    fix:`<code>if (box.state === "closed" || box.tradeEligible === false) continue;</code>`
  },
];

const sevColor = {
  "🔴 HIGH":"#dc2626",
  "🟡 MEDIUM":"#d97706",
  "🟠 LOW-MEDIUM":"#ea580c",
  "🔵 LOW":"#2563eb",
};

const cards = bugs.map((b, i) => `
<div style="border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:18px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <span style="font-size:1.1em;font-weight:700;color:${sevColor[b.sev] ?? "#333"};">${b.sev}</span>
    <span style="font-size:1em;font-weight:700;">#${i+1} ${b.title}</span>
  </div>
  <div style="font-size:0.82em;color:#64748b;margin-bottom:10px;font-family:monospace;">📁 ${b.file}</div>
  <div style="font-size:0.88em;line-height:1.7;margin-bottom:10px;">${b.detail}</div>
  <div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;font-size:0.86em;">
    <strong>수정 방향:</strong> ${b.fix}
  </div>
</div>`).join("");

const summary = [
  {sev:"🔴 HIGH",  count: bugs.filter(b=>b.sev==="🔴 HIGH").length},
  {sev:"🟡 MEDIUM",count: bugs.filter(b=>b.sev==="🟡 MEDIUM").length},
  {sev:"🟠 LOW-MEDIUM",count:bugs.filter(b=>b.sev==="🟠 LOW-MEDIUM").length},
  {sev:"🔵 LOW",   count: bugs.filter(b=>b.sev==="🔵 LOW").length},
].filter(r=>r.count>0).map(r=>`<span style="margin-right:16px;"><strong>${r.sev}</strong> ${r.count}건</span>`).join("");

const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>[YSTOCK] 매매로직 버그 리포트</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#1a1a1a;max-width:820px;margin:0 auto;padding:28px;">

<h1 style="font-size:1.2em;border-bottom:3px solid #dc2626;padding-bottom:8px;color:#7f1d1d;">
  🐛 매매로직 버그 리포트
</h1>
<p style="color:#64748b;font-size:0.88em;">생성: ${now} · 대상 파일: runner-fsm.js, ws-fsm.js, runner.js</p>

<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:0.9em;">
  ${summary}
  <span style="color:#475569;">총 ${bugs.length}건</span>
</div>

${cards}

<hr style="margin:28px 0;border:none;border-top:1px solid #e2e8f0;">
<p style="font-size:0.82em;color:#94a3b8;">
  이번 세션에서 수정 완료된 항목 (detect·catalog·quotes·chart-overlay): 4건<br>
  이 보고서의 버그는 아직 미수정 상태입니다.
</p>
</body></html>`;

// text version
const text = bugs.map((b,i)=>
  `#${i+1} [${b.sev}] ${b.title}\n파일: ${b.file}\n내용: ${b.detail.replace(/<[^>]+>/g,"").trim()}\n수정방향: ${b.fix.replace(/<[^>]+>/g,"").trim()}\n`
).join("\n---\n\n");

const host = String(process.env.SMTP_HOST??"").trim();
if(!host){console.error("SMTP_HOST 없음");process.exit(1);}
const port = Number(process.env.SMTP_PORT??587);
const from = resolveMailFrom();
const transport = nodemailer.createTransport({
  host, port:Number.isFinite(port)?port:587,
  secure:process.env.SMTP_SECURE==="1"||port===465,
  auth:(()=>{const u=String(process.env.SMTP_USER??"").trim();return u?{user:u,pass:String(process.env.SMTP_PASS??"")}:undefined;})(),
});
await transport.sendMail({
  from:{name:from.name,address:from.address},
  to,
  subject:`[YSTOCK] 매매로직 버그 리포트 — ${bugs.length}건 (HIGH ${bugs.filter(b=>b.sev==="🔴 HIGH").length}건)`,
  text,html,
});
console.log("발송 완료 →", to);
