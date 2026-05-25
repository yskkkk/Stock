/**
 * 박스권 v2 시나리오 — 코드·데이터 점검 보고서 (운영자/회원 안내용)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import { BOX_RANGE_MODEL_ID, isBoxRangeProgram } from "../box-range/constants.js";
import {
  BOX_RANGE_SCENARIO_VERSION,
  resolveBoxRangeMarketsForProgram,
} from "../box-range/migrate-active-programs.js";
import { resolveServerDataDir } from "../data-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_VERSION = "2026-05-26-audit-1";

function rolloutFlagPath() {
  return path.join(
    resolveServerDataDir(),
    ".box-range-scenario-rollout-v2.json",
  );
}

function readRolloutFlagSync() {
  try {
    const p = rolloutFlagPath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function catalogIndexExistsSync() {
  const p = path.join(
    resolveServerDataDir(),
    "box-range-catalog",
    "us",
    "_index.json",
  );
  return fs.existsSync(p);
}

function analyzeProgramsSync() {
  const programs = readProgramsStoreSync().programs ?? [];
  /** @type {typeof programs} */
  const notBoxRange = [];
  /** @type {typeof programs} */
  const autoSellOn = [];
  /** @type {typeof programs} */
  const usTrack = [];
  /** @type {typeof programs} */
  const cryptoTrack = [];
  /** @type {typeof programs} */
  const armed = [];
  /** @type {typeof programs} */
  const sim = [];

  for (const p of programs) {
    if (!isBoxRangeProgram(p)) notBoxRange.push(p);
    if (p.autoSellAtTarget !== false) autoSellOn.push(p);
    const mk = resolveBoxRangeMarketsForProgram(p);
    if (mk.us) usTrack.push(p);
    if (mk.crypto) cryptoTrack.push(p);
    if (p.status === "armed") armed.push(p);
    if (p.status === "sim") sim.push(p);
  }

  return {
    total: programs.length,
    notBoxRange,
    autoSellOn,
    usTrack,
    cryptoTrack,
    armed,
    sim,
  };
}

export function buildBoxRangeV2AuditReportContent() {
  const flag = readRolloutFlagSync();
  const analysis = analyzeProgramsSync();
  const hasCatalog = catalogIndexExistsSync();

  const subject =
    "[YSTOCK] 박스권 v2 매매 시나리오 점검 보고서 — 동작·모호점·확인 요청";

  const notBoxLines =
    analysis.notBoxRange.length === 0
      ? "· (없음) 저장소 프로그램이 모두 box-range 모델입니다."
      : analysis.notBoxRange
          .map(
            (p) =>
              `· ${p.name} (${p.id.slice(0, 8)}…) — modelId=${p.modelId}, status=${p.status}, autoSell=${p.autoSellAtTarget !== false}`,
          )
          .join("\n");

  const text = `안녕하세요.

요청하신 「박스권 v2」 실매매 시나리오에 대해, 코드·서버 데이터·안내 문구를 기준으로 점검한 결과입니다.
(보고서 ID: ${REPORT_VERSION})


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. 한 줄 요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 의도에 가장 가까운 부분: 코인(빗썸) 실매매·시뮬 — Pine PRO 박스 탐지 → 하단 이탈 후 중심가 재돌파 시 매수 → 박스 상·하단 익절·손절.
· 미국(S&P500)은 카탈로그·armed 실매매 FSM까지 연결됐으나, 「중심가만 터치하면 매수」와 안내 메일·UI 문구가 코드와 어긋난 곳이 있습니다.
· 서버에 아직 box-range가 아닌 프로그램이 있으면 v2가 그 프로그램에는 적용되지 않습니다(아래 §1).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 지금 서버에 저장된 프로그램 상태 (${analysis.total}개)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· armed: ${analysis.armed.length}개 · sim: ${analysis.sim.length}개
· 박스권 트랙(마이그레이션 규칙 기준) — 코인: ${analysis.cryptoTrack.length}개 · 미국: ${analysis.usTrack.length}개
· autoSellAtTarget 켜짐(구 ATR 자동매도와 충돌 가능): ${analysis.autoSellOn.length}개
· modelId가 box-range가 아님 → v2 미적용:
${notBoxLines}

롤아웃 플래그: ${flag ? `v${flag.version} done=${flag.done} migrated=${flag.migrated ?? "?"} at=${flag.atMs ? new Date(flag.atMs).toLocaleString("ko-KR") : "?"}` : "없음"}
S&P500 카탈로그 인덱스 파일: ${hasCatalog ? "있음" : "없음(스캔 미실행 또는 경로 없음)"}


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 원하신 시나리오 vs 실제 코드 (트랙별)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【A】 코인(빗썸) — 대체로 의도대로

  ✓ 1h/4h/1d 각각 독립 박스 탐지(봉 합치지 않음)
  ✓ armed: 빗썸 실매매 매수·매도 / sim: 시뮬 매수·매도(simAutoBuy 켜져 있을 때)
  ✓ 매수 조건: idle → 가격이 박스 하단 이탈(armed) → 이후 중심(mid) 이상이면 매수
  ✓ 매도: in_position 중 상단(top)=익절, 하단(bottom)=손절 (박스 lot 단위)
  ✓ 텔레그램: 중심가 매수 시도 직전 1회 알림
  ✓ autoSellAtTarget=false 이면 기존 ATR 일괄 자동매도와 분리

  △ 모호·주의
  · 거래내역 행의 targetSellPrice/stopLossPrice는 코인 매수 시 null일 수 있음 → UI는 박스 상태 API·보유 탭의 박스별 가격을 봐야 함
  · 이미 박스 안(하단 위)에서만 움직이면 「하단 이탈」이 없어 armed로 안 넘어가 매수가 안 날 수 있음


【B】 미국(S&P500) — 부분 구현, 안내와 차이 큼

  ✓ 30분마다 S&P500 스캔 → server/.data/box-range-catalog/us/*.json
  ✓ armed 프로그램만 runner가 카탈로그 박스를 trading store에 연결(틱당 최대 ${process.env.STOCK_BOX_RANGE_US_SLOTS_PER_TICK ?? 20}종목)
  ✓ 매수·매도 FSM은 코인과 동일한 상태머신(하단 이탈 → 중심 재돌파)
  ✓ 매수 기록 시 익절(top)·손절(bottom)을 portfolio에 저장
  ✓ 상단 메뉴 「박스권」 탭: 로고 그리드 + 유효 박스 가격 카드 (로그인 필요)

  ✗ 안내 메일/기대와 다른 점 (중요)
  1) 「유효 박스 중심가 도달 시 매수」처럼 읽히지만, 코드는 코인과 같이 「하단 이탈 후 중심가 재돌파」입니다. 처음부터 박스 안에만 있으면 매수 트리거가 없을 수 있습니다.
  2) US 시뮬(sim) 프로그램: tickUsProgram이 armed가 아니면 즉시 return → 미국 박스 자동매매 없음(안내에 시뮬 미국 매매가 있다고 읽히면 오해).
  3) US 실매매 매도: recordLiveTradeSellSync에 simulated:true 고정 → 토스 실매도 API 호출 없음, 앱 체결 기록·포트폴리오만 갱신.
  4) US 실매매 매수: TOSS_LIVE_ORDERS_ENABLED=1 이고 토스 키·계좌 ready일 때만 실주문 시도, 아니면 simulated 매수.
  5) 실매매 탭 「박스권(S&P500)」 서브탭은 제거됨 → 상단 「박스권」 탭으로 이동(이메일 본문 §4는 구 UI 기준).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. v2 롤아웃(일괄 적용)이 하는 일 / 안 하는 일
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

하는 일
  · 모든 프로그램 modelId → box-range
  · markets: 코인 우선(원래 crypto 켜져 있고 us와 겹치면 crypto만) / 아니면 us만
  · autoSellAtTarget → false
  · armed일 때 armedMarkets.kr=false, crypto는 트랙에 맞게

안 하는 일
  · 롤아웃 플래그가 이미 done이면 서버 재기동만으로는 재마이그레이션 안 함(새 프로그램·수동으로 default로 바꾼 것은 그대로)
  · 국내(KR) 전용 프로그램을 KR로 두지 않고 us:true로 보낼 수 있음(현재 규칙상 kr은 항상 false)
  · 기존 보유 종목 청산·프로그램 삭제 없음


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 확인된 버그·리스크 (우선순위)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[높음] box-range가 아닌 프로그램은 FSM·자동매도 규칙이 v2가 아님
  → 지금 ${analysis.notBoxRange.length}개. node server/box-range/apply-scenario-rollout.js --force 로 재적용 권장.

[높음] US 매수 트리거 문구 vs 코드 불일치 (하단 이탈 선행 조건)
  → 안내·기대를 코드에 맞출지, 코드를 「중심가 1회 터치」로 바꿀지 결정 필요.

[중간] US sim 자동매매 없음 — 시뮬은 코인만 FSM 동작.

[중간] US live 매도는 ledger만(simulated) — 실계좌 매도는 미연동.

[중간] 카탈로그→프로그램 연결 속도 — 틱당 신규 슬롯 제한으로 armed US 프로그램이 많은 박스를 한꺼번에 못 씀.

[낮음] v2 안내 메일 기본 수신: allMembers=true → 실매매 프로그램 없는 가입자도 발송될 수 있었음.

[낮음] 개발 서버 Express 캐시 — API가 HTML을 주면 「서버 응답을 읽을 수 없습니다」(최근 수정: Vite 기동 시 Express 재생성).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 모호해서 결정이 필요한 것 (답 주시면 구현 맞출 수 있음)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Q1. 국내(KR)만 켠 프로그램 → US 트랙? 코인? KR 유지? (현재는 US로 감)

Q2. US+코인 둘 다 켠 프로그램 → 코인만? US+코인 둘 다? (현재는 코인만)

Q3. US 매수: 「하단 이탈 → 중심 재돌파」 유지 vs 「중심가 첫 터치만」?

Q4. US 시뮬도 카탈로그 박스로 자동 매매할까요? (현재는 안 함)

Q5. US 실매매 매도: 언제 토스 실주문까지 연결할까요? (현재는 기록만)

Q6. v2 재적용: 지금 default 모델 프로그램을 강제 box-range로 바꿀까요?

Q7. 안내 메일/UI: 「실매매 → 박스권(S&P500)」 문구를 상단 「박스권」 탭으로 통일할까요?


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 직접 확인하는 방법 (체크리스트)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ node server/box-range/apply-scenario-rollout.js --force --no-email
  → 모든 프로그램 modelId=box-range, autoSellAtTarget=false 인지
□ STOCK_BOX_RANGE_SP500_SCAN=1, 서버 가동 후 server/.data/box-range-catalog/us/_index.json 생성
□ armed 코인: 박스 하단 이탈 → 중심 돌파 시 로그 [box-range:buy]·텔레그램
□ armed US: 카탈로그 eligible 박스 연결 후 동일 FSM·[box-range:buy]
□ 상단 「박스권」 탭: 로고·카드·/api/box-range/catalog JSON 응답
□ 거래내역: 보유 종목 등락·목표매도·손절 표시


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 결론 — 「원하는 대로 되나?」
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 코인 실매매·시뮬 중심으로 보면: 예, 대체로 원하신 박스권 lot·익절·손절·텔레그램 흐름에 맞습니다.
· S&P500·안내 메일 수준의 「중심가 도달 매수·시뮬 US·실매도」까지 포함하면: 아직 아닙니다. 위 §2·§4·§5 차이를 먼저 맞춰야 합니다.
· 지금 당장: default 모델로 남은 프로그램이 있으면 v2가 적용되지 않으므로 --force 마이그레이션을 권장합니다.


이 메일은 자동 점검 보고서입니다. Q1~Q7에 답 주시면 그에 맞춰 코드·안내를 맞출 수 있습니다.

YSTOCK · ${REPORT_VERSION}`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.75;color:#1a1a1a;max-width:720px;margin:0 auto;padding:24px;">
<h1 style="font-size:1.25em;color:#1e40af;">박스권 v2 시나리오 점검 보고서</h1>
<p>보고서 ID: <code>${REPORT_VERSION}</code></p>

<h2 style="border-bottom:2px solid #2563eb;padding-bottom:6px;">0. 한 줄 요약</h2>
<ul>
<li><strong>코인 armed/sim</strong>: 의도에 가장 근접 (하단 이탈 → 중심 재돌파 → TP/SL)</li>
<li><strong>미국 armed</strong>: 카탈로그·FSM 연결됨, 다만 「중심가만」 매수·시뮬 US·실매도는 코드/안내와 불일치</li>
<li><strong>box-range 아닌 프로그램 ${analysis.notBoxRange.length}개</strong>: v2 미적용 → <code>apply-scenario-rollout.js --force</code> 권장</li>
</ul>

<h2 style="border-bottom:2px solid #2563eb;padding-bottom:6px;">1. 현재 프로그램 (${analysis.total}개)</h2>
<pre style="background:#f8fafc;padding:12px;font-size:0.85em;white-space:pre-wrap;">${notBoxLines.replace(/</g, "&lt;")}</pre>
<p>롤아웃: ${flag ? `v${flag.version}, migrated=${flag.migrated ?? 0}` : "없음"} · 카탈로그: ${hasCatalog ? "있음" : "없음"}</p>

<h2 style="border-bottom:2px solid #2563eb;padding-bottom:6px;">2. 트랙별 — 코드 vs 기대</h2>
<table cellpadding="8" style="border-collapse:collapse;width:100%;font-size:0.9em;">
<tr style="background:#f1f5f9;"><th align="left">항목</th><th>코인</th><th>미국 US</th></tr>
<tr><td>매수 조건</td><td>하단 이탈 → 중심 재돌파</td><td><strong>동일</strong> (안내의 「중심가만」과 다름)</td></tr>
<tr><td>시뮬 FSM</td><td>동작</td><td><strong>없음</strong></td></tr>
<tr><td>실매도</td><td>빗썸 API</td><td><strong>기록만</strong> (simulated)</td></tr>
<tr><td>UI</td><td>도크·거래내역</td><td>상단 「박스권」 탭</td></tr>
</table>

<h2 style="border-bottom:2px solid #2563eb;padding-bottom:6px;">3. 확인 요청 (Q1~Q7)</h2>
<ol>
<li>KR-only 프로그램 → 어떤 트랙?</li>
<li>US+코인 동시 → 코인만 vs 둘 다?</li>
<li>US 매수: 하단 이탈 선행 vs 중심가 1회?</li>
<li>US 시뮬 자동매매 필요?</li>
<li>US 실매도 토스 연동 시점?</li>
<li>default 프로그램 강제 v2 전환?</li>
<li>안내 문구를 상단 박스권 탭 기준으로 통일?</li>
</ol>

<h2 style="border-bottom:2px solid #2563eb;padding-bottom:6px;">4. 결론</h2>
<p>코인 중심 시나리오는 <strong>대체로 OK</strong>. S&P500·안내 문구 수준의 기대는 <strong>추가 정합 작업 필요</strong>.</p>
<p style="color:#64748b;font-size:0.9em;margin-top:32px;">YSTOCK · ${REPORT_VERSION}</p>
</body></html>`;

  return { subject, text, html, analysis, flag, hasCatalog };
}

/**
 * @param {{ to: string; dryRun?: boolean }} opts
 */
export async function sendBoxRangeV2AuditReportEmail(opts) {
  const to = String(opts.to ?? "").trim();
  if (!to) {
    throw new Error("수신 이메일이 필요합니다 (--to 또는 STOCK_AUDIT_REPORT_TO).");
  }
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정 — .env SMTP_* 또는 EMAIL_VERIFY_MOCK=1");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const { subject, text, html, analysis } = buildBoxRangeV2AuditReportContent();
  if (dryRun) {
    return { to, dryRun: true, subject, analysis };
  }
  await sendTransactionalEmail({ to, subject, text, html });
  return { to, dryRun: false, subject, sent: true, analysis };
}
