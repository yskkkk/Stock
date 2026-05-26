/**
 * server/ 전역 버그·리스크 감사 — 메일 보고
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";

export const SERVER_AUDIT_REPORT_VERSION = "2026-05-26-server-audit-1";
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
      "Pine TV(ms)와 불일치; mergeBars>0일 때 시간 간격 병합이 거의 항상 통과해 박스가 과다 병합될 수 있음",
    fix: "gap을 초 단위로 맞추거나 엔진 내부 시간을 ms로 통일",
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
    file: "box-range/quotes.js (수정됨 d92cbcb)",
    issue: "과거: picks 1m quotedAtMs 며칠 전 → FSM 전량 스킵",
    impact: "진입 대기(armed) 0개처럼 보이는 증상",
    fix: "배포 확인·STOCK_BOX_RANGE_QUOTE_* 모니터링 (코드는 maxAgeMs:0 반영)",
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
    file: "tests",
    issue: "vitest: chart-overlay.test 1 fail; merge/quotes.test suite 없음",
    impact: "CI/로컬 test 신뢰도 저하",
    fix: "flatBoxCandles 기대값 조정 또는 node:test→vitest 통일",
  },
];

const FIXED_RECENT = [
  "시뮬 거래내역 손익: entryPrice 대신 평균 매입가 (97a0534)",
  "박스 기간 표시: detect-pine extMs 초 오류 (b11273a)",
  "박스 US 시세 stale → armed 미갱신 (d92cbcb)",
  "빗썸 매도 장부·스윕 (5aae63e)",
];

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
  const p0 = FINDINGS.filter((f) => f.severity === "P0");
  const p1 = FINDINGS.filter((f) => f.severity === "P1");
  const p2 = FINDINGS.filter((f) => f.severity === "P2");
  const subject = `[YSTOCK] server/ 버그·리스크 감사 (${SERVER_AUDIT_REPORT_VERSION})`;

  const text = `YSTOCK — server/ 정적 감사 (${SERVER_AUDIT_REPORT_VERSION})

■ 요약
· P0 ${p0.length} · P1 ${p1.length} · P2 ${p2.length} (총 ${FINDINGS.length})
· 최근 수정됨: ${FIXED_RECENT.join(" / ")}

■ 테스트
${testSummary || "(미실행)"}

■ P0 — 즉시
${p0.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}\n  → ${f.fix}`).join("\n\n")}

■ P1 — 높음
${p1.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}`).join("\n\n")}

■ P2 — 보통
${p2.map((f) => `[${f.id}] ${f.file}\n  ${f.issue}`).join("\n\n")}

■ 권장 순서
1) P0-1 portfolio 쓰기 직렬화
2) P0-2 detect-pine timeNear 단위
3) P1-4 빗썸 체결 동기화 로그
4) P1-10 picks/refresh 권한

— YSTOCK 자동 감사
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>server 감사</title></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.55;color:#111;max-width:900px;">
<h1>server/ 버그·리스크 감사</h1>
<p><strong>${SERVER_AUDIT_REPORT_VERSION}</strong> · P0 ${p0.length} / P1 ${p1.length} / P2 ${p2.length}</p>

<h2>최근 수정(참고)</h2>
<ul>${FIXED_RECENT.map((x) => `<li>${x}</li>`).join("")}</ul>

<h2>테스트</h2>
<pre style="background:#f8fafc;padding:10px;font-size:0.85em;white-space:pre-wrap;">${(testSummary || "—").replace(/</g, "&lt;")}</pre>

${sectionHtml("P0 — 즉시", p0)}
${sectionHtml("P1 — 높음", p1)}
${sectionHtml("P2 — 보통", p2)}

<p style="color:#64748b;margin-top:2rem;">정적 분석·코드 리뷰 기준. 프로덕션 .data·부하 테스트는 별도.</p>
</body></html>`;

  return { subject, text, html, counts: { p0: p0.length, p1: p1.length, p2: p2.length } };
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
  if (dryRun) return { to, dryRun: true, ...payload.counts };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject, ...payload.counts };
}
