/**
 * server/ 전역 버그·리스크 감사 — 메일 보고
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import { readBoxRangeStoreSync } from "../box-range/store.js";
import { isBoxRangeProgram } from "../box-range/constants.js";

export const SERVER_AUDIT_REPORT_VERSION = "2026-05-27-server-audit-2";
export const DEFAULT_SERVER_AUDIT_TO = "samron3@naver.com";

/** @type {{ severity: string; id: string; file: string; issue: string; impact: string; fix: string }[]} */
const FINDINGS = [
  {
    severity: "P0",
    id: "P0-1",
    file: "live-trade-portfolio-store.js",
    issue: "readStoreSync → 수정 → writeStoreSync RMW에 프로세스 내 직렬화(락/체인) 없음",
    impact:
      "박스 FSM·빗썸 체결 동기화·API 매도가 동시에 돌면 거래 레코드 유실·중복 가능",
    fix: "ops-file-dev-store.js처럼 writeChain 또는 파일 락으로 portfolio 쓰기 직렬화",
  },
  {
    severity: "P0",
    id: "P0-2",
    file: "box-range/detect-pine.js (timeNear)",
    issue: "봉 time은 초(unix)인데 merge gap = mBars×tfSec×1000(ms 스케일)",
    impact:
      "Pine TV(ms)와 불일치; mergeBars>0일 때 시간 간격 병합이 거의 항상 통과해 legacy pine 탐지 박스 과다 병합",
    fix: "gap을 초 단위로 맞추거나 엔진 내부 시간을 ms로 통일 (PRO v2 core는 timesNearOverlap 초 단위 사용)",
  },
  {
    severity: "P1",
    id: "P1-1",
    file: "live-trade-programs-store.js ↔ live-trade-portfolio-store.js",
    issue: "순환 import (programHasOnlySimulatedBuyTradesSync)",
    impact: "ESM 초기화 순서·테스트·리팩터 시 간헐 실패",
    fix: "공통 헬퍼를 live-trade-shared.js 등으로 분리",
  },
  {
    severity: "P1",
    id: "P1-2",
    file: "user-sessions-store.js",
    issue: "writeFileSync 직접 쓰기(tmp+rename 없음)",
    impact: "크래시 시 user-sessions.json 손상 → 전원 로그아웃",
    fix: "store-json atomic write 패턴 적용",
  },
  {
    severity: "P1",
    id: "P1-3",
    file: "user-sessions-store.js",
    issue: "getSessionSync 시 prune 후 즉시 write",
    impact: "동시 로그인/검증 시 세션 배열 경쟁",
    fix: "prune을 주기 작업 또는 쓰기 체인으로 분리",
  },
  {
    severity: "P1",
    id: "P1-4",
    file: "live-trade-bithumb-exchange-trades.js:210",
    issue: "recordLiveTradeSellSync 실패 catch 무음",
    impact: "거래소 매도는 있는데 앱 미기록 → 잔고·PnL 불일치",
    fix: "liveTradeLogWarn + 실패 카운터",
  },
  {
    severity: "P1",
    id: "P1-5",
    file: "bithumb-trading-adapter.js + live-trade-bithumb-ledger.js",
    issue: "매도 전 장부 낙관 차감; 실패 시 refresh .catch(()=>{})",
    impact: "체결 실패·동기화 실패 시 장부·거래소 불일치가 조용히 남음",
    fix: "체결 확인 후 차감 또는 보상·재시도·실패 로그",
  },
  {
    severity: "P1",
    id: "P1-6",
    file: "box-range/store.js",
    issue: "patchBoxSync RMW 무락(atomic 파일만)",
    impact: "WS·스캔·FSM 동시 틱 시 박스 상태 덮어쓰기",
    fix: "box-range 전용 write chain 또는 단일 runner 큐",
  },
  {
    severity: "P1",
    id: "P1-7",
    file: "feedback-inbox.js, access-control.js",
    issue: "JSON store 비원자 직접 쓰기",
    impact: "동시 쓰기 시 파일 손상",
    fix: "tmp + renameSync",
  },
  {
    severity: "P1",
    id: "P1-8",
    file: "ops-*-store.js (writeChain)",
    issue: "writeChain = p.catch(() => {}) — 체인 에러 삼킴",
    impact: "한 번 실패 후 이후 디스크 쓰기가 조용히 깨질 수 있음",
    fix: "catch에서 로그 + writeChain 재설정",
  },
  {
    severity: "P1",
    id: "P1-9",
    file: "live-trade-portfolio-store.js readStoreSync",
    issue: "JSON 파싱 실패 시 catch → 빈 store 반환",
    impact: "파일 손상 시 거래 이력이 조용히 사라진 것처럼 보임",
    fix: "StoreCorruptError throw(다른 store와 동일)",
  },
  {
    severity: "P1",
    id: "P1-10",
    file: "create-app.js POST /api/picks/refresh",
    issue: "requireUserAuth만 — 일반 로그인 사용자도 스크리너 전체 재실행",
    impact: "악의·실수로 서버 부하(DoS) 유발 가능",
    fix: "requireAccessAdmin 또는 rate limit",
  },
  {
    severity: "P1",
    id: "P1-11",
    file: "live-trade-arm-gate.js",
    issue: 'isProgramArmedForMarket("us")는 mk.us만 확인, toss arm 미확인',
    impact: "코인만 빗썸 arm한 프로그램에 us:true면 US live FSM 매수 시도",
    fix: "US도 armedMarkets 또는 toss-ready + toss arm 확인",
  },
  {
    severity: "P1",
    id: "P1-12",
    file: "server/**/*.test.js (node:test)",
    issue: "11개 box-range·live-trade 테스트가 node:test 형식 — vitest가 suite 미인식",
    impact: 'npm test 시 "No test suite found" 11 fail · CI 녹색/적색 혼란',
    fix: "vitest describe/it로 통일 또는 vite.config에 node:test runner 추가",
  },
  {
    severity: "P1",
    id: "P1-13",
    file: "box-range/store.js upsertDetectedBoxSync",
    issue: "boxes.length>800 시 updatedAtMs 기준 600개로 잘림",
    impact: "장기 운영 시 idle/armed 박스가 조용히 삭제 → FSM 대상 소실",
    fix: "closed만 prune · in_position/armed 보호",
  },
  {
    severity: "P2",
    id: "P2-1",
    file: "access-control.js",
    issue: "ACCESS_CONTROL_DISABLED=1 시 IP 게이트 해제",
    impact: "프로덕션 설정 실수 시 무방비 API",
    fix: "prod에서 disabled 거부 또는 startup fail",
  },
  {
    severity: "P2",
    id: "P2-2",
    file: "create-app.js",
    issue: "/api/news, /api/stock-search/hot 등 인증 없음(IP만)",
    impact: "허용 IP 넓을 때 스크래핑·외부 API 비용",
    fix: "민감도별 requireUserAuth 또는 rate limit",
  },
  {
    severity: "P2",
    id: "P2-3",
    file: "picks-recommendation-enrich.js 등",
    issue: "일부 picks/ops JSON 비원자 쓰기",
    impact: "백그라운드 작업 중 크래시 시 캐시 손상",
    fix: "writeJsonStoreSync 패턴 통일",
  },
  {
    severity: "P2",
    id: "P2-4",
    file: "live-trade-portfolio-store.js totalReturnPct",
    issue: "분모 전체 매수 vs 분자 실현+미실현 혼합",
    impact: "부분 매도 후 프로그램 수익률 왜곡 가능",
    fix: "openReturnPctFromHoldings와 동일 기준 통일",
  },
  {
    severity: "P2",
    id: "P2-5",
    file: "runner-fsm.js (live tick)",
    issue: "Pine OHLC vs lastPrice — wick low/high 미반영",
    impact: "dipLow·트리거·TP/SL 타이밍이 Pine 대비 ±1틱 차이",
    fix: "현재봉 high/low 캐시 병합(전략 동일, 정밀도만)",
  },
  {
    severity: "P2",
    id: "P2-6",
    file: "live-trade-auto-sell.js + box-range FSM",
    issue: "default modelId armed 프로그램은 ATR auto-sell 경로, box-range FSM 분리",
    impact: "armed default 프로그램이 박스권과 다른 매매 경로로 동작",
    fix: "box-range 전환 또는 disarm",
  },
  {
    severity: "P2",
    id: "P2-7",
    file: "sim US/KR box-range 매수",
    issue: "recordLiveTradeBuyAsync(sim)에 targetSellPrice/stopLossPrice 미저장",
    impact: "sim 거래내역 TP/SL 빈칸",
    fix: "live와 동일 targets 기록",
  },
];

const FIXED_RECENT = [
  "PRO v2 TP 후 idle 리셋·dipLow 추적 (5c6d025)",
  "시뮬 거래내역 손익: 평균 매입가 (97a0534)",
  "박스 US 시세 stale → armed 미갱신 (d92cbcb)",
  "chart-overlay.test 통과 (vitest)",
  "등락률 costBasis 우선 (holdingPurchaseCostForReturn)",
];

function analyzeRuntimeSync() {
  const programs = readProgramsStoreSync().programs ?? [];
  const boxProgs = programs.filter(isBoxRangeProgram);
  const armed = programs.filter((p) => p.status === "armed");
  const armedDefault = armed.filter((p) => !isBoxRangeProgram(p));
  const boxes = readBoxRangeStoreSync().boxes ?? [];
  const open = boxes.filter((b) => b.state !== "closed");
  return {
    programs: programs.length,
    boxPrograms: boxProgs.length,
    armed: armed.length,
    armedDefault: armedDefault.length,
    sim: programs.filter((p) => p.status === "sim").length,
    boxesTotal: boxes.length,
    openBoxes: open.length,
    armedBoxes: open.filter((b) => b.state === "armed").length,
    inPosition: open.filter((b) => b.state === "in_position").length,
  };
}

function sectionHtml(severity, items) {
  if (!items.length) return "";
  const rows = items
    .map(
      (f) =>
        `<tr><td>${f.id}</td><td><code>${f.file}</code></td><td>${f.issue}</td><td>${f.impact}</td><td>${f.fix}</td></tr>`,
    )
    .join("");
  return `<h2>${severity} (${items.length})</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:0.82em;width:100%;">
<thead><tr><th>ID</th><th>파일</th><th>이슈</th><th>영향</th><th>제안</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

export function buildServerAuditReportContent(testSummary = "") {
  const rt = analyzeRuntimeSync();
  const p0 = FINDINGS.filter((f) => f.severity === "P0");
  const p1 = FINDINGS.filter((f) => f.severity === "P1");
  const p2 = FINDINGS.filter((f) => f.severity === "P2");
  const subject = `[YSTOCK] server/ 백엔드 전역 디버그·버그 리포트 (${SERVER_AUDIT_REPORT_VERSION})`;

  const text = `YSTOCK — server/ 백엔드 전역 감사 (${SERVER_AUDIT_REPORT_VERSION})

■ 요약
· P0 ${p0.length} · P1 ${p1.length} · P2 ${p2.length} (총 ${FINDINGS.length})
· 최근 수정: ${FIXED_RECENT.join(" / ")}

■ 런타임 스냅샷
· 프로그램 ${rt.programs} (box-range ${rt.boxPrograms} / armed ${rt.armed} / sim ${rt.sim})
· armed non-box-range ${rt.armedDefault} — 스크리너·ATR 경로 주의
· 박스 state ${rt.boxesTotal} (미청산 ${rt.openBoxes}: armed ${rt.armedBoxes} / pos ${rt.inPosition})

■ 테스트
${testSummary || "(미실행)"}

■ P0 — 즉시
${p0.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}\n  → ${f.fix}`).join("\n\n")}

■ P1 — 높음
${p1.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}\n  → ${f.impact}`).join("\n\n")}

■ P2 — 보통
${p2.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}`).join("\n\n")}

■ 권장 순서
1) P0-1 portfolio 쓰기 직렬화
2) P0-2 detect-pine timeNear 단위
3) P1-4 빗썸 체결 동기화 로그
4) P1-10 picks/refresh 권한
5) P1-11 US armed gate
6) P1-12 vitest/node:test 통일

■ 모듈 커버리지
· HTTP: create-app.js (auth, picks, live-trade, box-range, ops)
· 실매매: live-trade-runner, auto-sell, bithumb/toss adapter, portfolio-store
· 박스권: detect-pro-core, runner-fsm, catalog scan, ws-fsm
· 영속: store-json(원자) vs portfolio/sessions/feedback(비원자 혼재)
· 백그라운드: dev-sidecars (screener, box-range tick, exchange sync)

— YSTOCK 자동 감사 · ${SERVER_AUDIT_REPORT_VERSION}
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>server 감사</title></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.55;color:#111;max-width:900px;">
<h1>server/ 백엔드 전역 디버그·버그 리포트</h1>
<p><strong>${SERVER_AUDIT_REPORT_VERSION}</strong> · P0 ${p0.length} / P1 ${p1.length} / P2 ${p2.length}</p>

<h2>런타임</h2>
<p>프로그램 ${rt.programs} · box-range ${rt.boxPrograms} · armed ${rt.armed} (non-box ${rt.armedDefault})<br>
박스 ${rt.boxesTotal} · open ${rt.openBoxes} (armed ${rt.armedBoxes} / pos ${rt.inPosition})</p>

<h2>최근 수정</h2>
<ul>${FIXED_RECENT.map((x) => `<li>${x}</li>`).join("")}</ul>

<h2>테스트</h2>
<pre style="background:#f8fafc;padding:10px;font-size:0.85em;white-space:pre-wrap;">${(testSummary || "—").replace(/</g, "&lt;")}</pre>

${sectionHtml("P0 — 즉시", p0)}
${sectionHtml("P1 — 높음", p1)}
${sectionHtml("P2 — 보통", p2)}

<p style="color:#64748b;margin-top:2rem;">정적 분석·코드 리뷰·npm test 기준. 부하·침투 테스트 별도.</p>
</body></html>`;

  return { subject, text, html, counts: { p0: p0.length, p1: p1.length, p2: p2.length }, rt };
}

export async function sendServerAuditReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_SERVER_AUDIT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildServerAuditReportContent(opts.testSummary ?? "");
  if (dryRun) return { to, dryRun: true, ...payload.counts, rt: payload.rt };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject, ...payload.counts, rt: payload.rt };
}
