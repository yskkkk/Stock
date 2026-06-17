#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import nodemailer from "nodemailer";
import { resolveMailFrom } from "../server/email-sender.js";
loadEnvFile();

const to = "samron3@naver.com";
const now = new Date().toLocaleDateString("ko-KR", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});

const bugs = [
  // ─── HIGH ────────────────────────────────────────────────────────────────
  {
    sev: "🔴 HIGH",
    section: "box-range/store.js",
    title: "JSON 파일 비원자적 read-write — 동시 패치 시 변경 유실",
    file: "server/box-range/store.js · upsertDetectedBoxSync, patchBoxSync",
    detail: `<code>readBoxRangeStoreSync()</code> → 수정 → <code>writeBoxRangeStoreSync()</code> 패턴이 원자적이지 않습니다.<br>
3초 폴러(<b>runner.js</b>)와 WebSocket FSM(<b>ws-fsm.js</b>)이 거의 동시에 같은 박스를 패치하면,<br>
두 프로세스가 모두 <b>같은 구버전 파일을 읽은 뒤 각자 기록</b>하므로 나중에 쓴 쪽이 앞선 변경을 덮어씁니다.<br><br>
<b>시나리오</b>: WS-FSM이 박스를 <code>in_position</code>으로 패치하는 사이,<br>
폴러가 구버전(armed)을 읽고 FSM을 재실행 → 중복 매수 시도.`,
    fix: `단기: 쓰기 직전 재조회(<code>readBoxRangeStoreSync</code> → 바로 write) 또는<br>
파일 I/O를 직렬화하는 내부 큐(Promise chain) 도입.<br>
장기: SQLite 단일 파일 DB 교체(WAL 모드 자동 동시성 처리).`,
  },

  // ─── MEDIUM ──────────────────────────────────────────────────────────────
  {
    sev: "🟡 MEDIUM",
    section: "bithumb-ws-ticker.js",
    title: "byYahooSymbol 맵 — 제거된 심볼 시세 무기한 잔존",
    file: "server/bithumb-ws-ticker.js · setBithumbWsTickerWanted (line 67~89)",
    detail: `<code>setBithumbWsTickerWanted(newSymbols)</code>는 <code>wantedKrwCodes</code>(구독 목록)를 새 Set으로 교체하지만,<br>
실시간 시세 캐시 <code>byYahooSymbol</code> Map에서는 제거된 심볼을 삭제하지 않습니다.<br><br>
결과: 감시 목록에서 빠진 심볼의 마지막 시세가 캐시에 무기한 남아,<br>
<b>FSM이 해당 심볼의 박스를 평가할 때 수 분~수십 분 된 가격으로 매매 판단.</b>`,
    fix: `<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.83em;">// setBithumbWsTickerWanted 내, wantedKrwCodes = next; 이후 추가:
for (const [sym, row] of byYahooSymbol) {
  if (!next.has(row.code)) byYahooSymbol.delete(sym);
}</pre>`,
  },
  {
    sev: "🟡 MEDIUM",
    section: "lot-reconcile.js",
    title: "재기동 복구 시 in_position → armed 복귀 (idle 이어야 함)",
    file: "server/box-range/lot-reconcile.js · reconcileBoxRangeLotsFromPortfolioSync (line 115~118)",
    detail: `매수 거래 기록이 없는 <code>in_position</code> 박스를 복구할 때 <code>state: "armed"</code>으로 되돌립니다.<br>
<code>armed</code> 상태는 "가격이 하단을 이미 터치했음"을 의미하므로,<br>
다음 틱에서 <code>lastPrice &gt;= box.mid</code>이면 <b>즉시 재매수를 시도</b>합니다.<br><br>
정상 흐름(<code>idle → armed → in_position</code>)을 건너뛰는 부작용.`,
    fix: `<code>state: "idle"</code>으로 복귀하여 가격이 하단에 닿는 정상 조건을 다시 충족해야 매수가 일어나도록 합니다.<br>
단, <code>box.armedAtMs</code>가 있으면 armed로 유지하는 조건부 처리도 가능합니다.`,
  },
  {
    sev: "🟡 MEDIUM",
    section: "live-trade-bithumb-ledger.js",
    title: "startBithumbLedgerPoller — running 가드 없어 중첩 호출 가능",
    file: "server/live-trade-bithumb-ledger.js · startBithumbLedgerPoller (line 136~153)",
    detail: `<code>startBoxRangeRunnerPoller</code>(runner.js)는 <code>running</code> 플래그로 이전 틱이 끝날 때까지 다음 틱 진입을 막지만,<br>
레저 폴러는 동일 패턴 없이 <code>setInterval(loop, POLL_MS)</code>만 사용합니다.<br><br>
빗썸 API 응답이 <code>POLL_MS(기본 10분)</code>을 넘으면 동시 다중 호출 발생 → 계좌 잔고 동시 조회·덮어쓰기.`,
    fix: `<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.83em;">let running = false;
const loop = () => {
  if (running) return;
  running = true;
  tickBithumbLedgerPoll()
    .catch(e => liveTradeLogWarn(...))
    .finally(() => { running = false; });
};</pre>`,
  },
  {
    sev: "🟡 MEDIUM",
    section: "runner.js",
    title: "tickCatalogProgram('crypto') — 크립토 카탈로그 디렉터리 없어 매 틱 디스크 I/O 낭비",
    file: "server/box-range/runner.js · tickProgram (line 154~156)",
    detail: `<code>tickProgram</code>은 크립토 프로그램에 대해 <code>tickCatalogProgram(program, "crypto")</code>를 호출하지만,<br>
크립토 카탈로그 디렉터리(<code>box-range-catalog/crypto/</code>)를 채우는 스캐너가 없습니다.<br><br>
매 3초 틱마다 존재하지 않는 디렉터리를 읽으려는 파일시스템 호출 발생 (에러 없이 빈 결과 반환이지만 불필요한 I/O).`,
    fix: `크립토 박스는 <code>tickCryptoProgram</code>이 직접 탐지하므로,<br>
<code>tickCatalogProgram(program, "crypto")</code> 호출을 제거하거나 카탈로그 디렉터리 존재 여부를 사전 체크합니다.`,
  },

  // ─── LOW ─────────────────────────────────────────────────────────────────
  {
    sev: "🔵 LOW",
    section: "runner.js",
    title: "runDetectionForTf — 최소 캔들 수(20) 하드코딩, 타임프레임 무시",
    file: "server/box-range/runner.js · runDetectionForTf (line 56)",
    detail: `<code>if (candles.length &lt; 20) return;</code> — 1h/4h/1d 모두 동일 기준 적용.<br>
1h는 충분하나 1d의 경우 상장 초기 종목(캔들 &lt; 20일)은 탐지 자체가 건너뛰어집니다.<br>
또한 최소값이 너무 작아 유효한 박스를 잡기 어려운 종목도 탐지 시도됩니다.`,
    fix: `타임프레임별 최소 캔들 수 정의: <code>{ "1h": 60, "4h": 30, "1d": 20 }</code> 또는<br>
<code>BOX_RANGE_MAX_EXPAND_BARS</code>를 하한으로 사용.`,
  },
  {
    sev: "🔵 LOW",
    section: "box-range/store.js",
    title: "박스 800→600 트리밍 시 in_position 박스 삭제 가능",
    file: "server/box-range/store.js · upsertDetectedBoxSync (line 283~287)",
    detail: `<pre style="background:#f8fafc;padding:8px;border-radius:4px;font-size:0.83em;">if (store.boxes.length > 800) {
  store.boxes = store.boxes
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, 600);  // updatedAt 오래된 순 제거
}</pre>
<code>updatedAtMs</code> 기준으로 200개를 제거할 때,<br>
오래 전 매수 후 포지션 유지 중인 <code>in_position</code> 박스가 낮은 updatedAtMs를 가지면 삭제될 수 있습니다.`,
    fix: `트리밍 전 <code>in_position</code> 박스를 보호: <code>.filter(b => b.state !== "in_position")</code>로 비포지션 박스만 정렬·제거합니다.`,
  },
  {
    sev: "🔵 LOW",
    section: "bithumb-ws-ticker.js",
    title: "WebSocket onmessage JSON 파싱 에러 미처리",
    file: "server/bithumb-ws-ticker.js · connect > ws.onmessage",
    detail: `수신 메시지가 유효한 JSON이 아닐 때(ping/pong 문자열, 오류 응답 등) <code>JSON.parse</code>가 throw하면<br>
unhandled exception으로 WebSocket 핸들러가 죽을 수 있습니다.`,
    fix: `<code>try { const d = JSON.parse(e.data); ... } catch { return; }</code> 래핑 추가.`,
  },
  {
    sev: "🔵 LOW",
    section: "box-range/runner-fsm.js",
    title: "processBoxFsmForProgram — box.top/bottom/mid 유효성 검사 없음",
    file: "server/box-range/runner-fsm.js (line 79~)",
    detail: `store의 <code>normalizeBox</code>가 이미 검증하지만, 직접 생성·패치된 박스가 invalid 값을 가질 경우<br>
<code>lastPrice &gt;= box.top</code> 비교에서 <code>NaN</code> → false 로 평가되어 매도가 영구 스킵됩니다.`,
    fix: `함수 진입부에 <code>if (!Number.isFinite(box.top) || !Number.isFinite(box.bottom)) return;</code> 추가.`,
  },
];

const sevColor = {
  "🔴 HIGH": "#dc2626",
  "🟡 MEDIUM": "#d97706",
  "🔵 LOW": "#2563eb",
};

const cards = bugs.map((b, i) => `
<div style="border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:16px;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
    <span style="font-size:1em;font-weight:700;color:${sevColor[b.sev] ?? "#333"};">${b.sev}</span>
    <span style="font-size:1em;font-weight:700;">#${i + 1} ${b.title}</span>
  </div>
  <div style="font-size:0.8em;color:#64748b;margin-bottom:8px;font-family:monospace;">📁 ${b.file}</div>
  <div style="font-size:0.87em;line-height:1.75;margin-bottom:10px;">${b.detail}</div>
  <div style="background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;font-size:0.84em;">
    <strong>수정 방향:</strong> ${b.fix}
  </div>
</div>`).join("");

const counts = {
  high: bugs.filter(b => b.sev === "🔴 HIGH").length,
  med: bugs.filter(b => b.sev === "🟡 MEDIUM").length,
  low: bugs.filter(b => b.sev === "🔵 LOW").length,
};

const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>[YSTOCK] 2차 전체 버그 리포트</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#1a1a1a;max-width:820px;margin:0 auto;padding:28px;">

<h1 style="font-size:1.2em;border-bottom:3px solid #dc2626;padding-bottom:8px;color:#7f1d1d;">
  🔍 전체 프로젝트 버그 리포트 (2차)
</h1>
<p style="color:#64748b;font-size:0.87em;">생성: ${now} &nbsp;|&nbsp; 직전 수정 완료 버그(8건) 제외 · 신규 발견 기준</p>

<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:0.9em;">
  ${counts.high ? `<span style="margin-right:16px;"><strong>🔴 HIGH</strong> ${counts.high}건</span>` : ""}
  ${counts.med ? `<span style="margin-right:16px;"><strong>🟡 MEDIUM</strong> ${counts.med}건</span>` : ""}
  ${counts.low ? `<span style="margin-right:16px;"><strong>🔵 LOW</strong> ${counts.low}건</span>` : ""}
  <span style="color:#475569;">총 ${bugs.length}건</span>
</div>

${cards}

<hr style="margin:28px 0;border:none;border-top:1px solid #e2e8f0;">
<div style="background:#f8fafc;border-radius:6px;padding:14px 18px;font-size:0.85em;color:#334155;">
  <strong>💡 구조적 개선 권고</strong><br><br>
  <b>1. JSON → SQLite 전환</b>: box-range-state.json의 read-write 경쟁 조건은 SQLite WAL 모드로 근본 해결 가능.<br>
  <b>2. 레저·박스 상태 직렬화</b>: 쓰기 작업을 단일 Promise 큐로 직렬화하면 파일 충돌 없이 현재 아키텍처 유지 가능.<br>
  <b>3. 박스 상태 머신 불변식</b>: idle→armed→in_position→closed 외 전이 검사를 patchBoxSync에 추가하면 FSM 버그 조기 발견 가능.
</div>

<p style="font-size:0.8em;color:#94a3b8;margin-top:20px;">
  이전 세션에서 수정 완료: boxSellInFlight, boxNotifyInFlight, targets 전달, tradeEligible 필터,<br>
  ledger refresh, lot null-boxId, proportionalFee 가드, avgEntry drift 가드 (8건)
</p>
</body></html>`;

const text = bugs.map((b, i) =>
  `#${i + 1} [${b.sev}] ${b.title}\n파일: ${b.file}\n내용: ${b.detail.replace(/<[^>]+>/g, "").replace(/\n+/g, " ").trim()}\n수정방향: ${b.fix.replace(/<[^>]+>/g, "").trim()}\n`
).join("\n---\n\n");

const host = String(process.env.SMTP_HOST ?? "").trim();
if (!host) { console.error("SMTP_HOST 없음"); process.exit(1); }
const port = Number(process.env.SMTP_PORT ?? 587);
const from = resolveMailFrom();
const transport = nodemailer.createTransport({
  host, port: Number.isFinite(port) ? port : 587,
  secure: process.env.SMTP_SECURE === "1" || port === 465,
  auth: (() => { const u = String(process.env.SMTP_USER ?? "").trim(); return u ? { user: u, pass: String(process.env.SMTP_PASS ?? "") } : undefined; })(),
});
await transport.sendMail({
  from: { name: from.name, address: from.address },
  to,
  subject: `[YSTOCK] 2차 버그 리포트 — ${bugs.length}건 (HIGH ${counts.high}건)`,
  text,
  html,
});
console.log("발송 완료 →", to);
