/**
 * 박스권 v2(S&P500·Pine PRO) 실매매 시나리오 — 실매매 프로그램 보유 회원 안내 메일
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  getUserNotificationEmailSync,
  listUsersSync,
} from "../users-store.js";
import { readProgramsStoreSync } from "../live-trade-programs-store.js";
import { resolveServerDataDir } from "../data-path.js";
import { BOX_RANGE_SCENARIO_VERSION } from "../box-range/migrate-active-programs.js";

const CAMPAIGN_ID = "box-range-scenario-v2-2026-05-26";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sentLogPath() {
  return path.join(
    resolveServerDataDir(),
    ".box-range-strategy-email-v2-sent.json",
  );
}

function readSentLogSync() {
  try {
    const p = sentLogPath();
    if (!fs.existsSync(p)) return { campaignId: CAMPAIGN_ID, sent: {} };
    const o = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!o || typeof o !== "object") return { campaignId: CAMPAIGN_ID, sent: {} };
    return {
      campaignId: String(o.campaignId ?? CAMPAIGN_ID),
      sent: o.sent && typeof o.sent === "object" ? o.sent : {},
    };
  } catch {
    return { campaignId: CAMPAIGN_ID, sent: {} };
  }
}

function writeSentLogSync(log) {
  const dir = resolveServerDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = sentLogPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(log, null, 0), "utf8");
  fs.renameSync(tmp, file);
}

/** 실매매 프로그램 1개 이상 등록한 userId */
function listLiveTradeUserIdsSync() {
  const ids = new Set();
  for (const p of readProgramsStoreSync().programs) {
    const uid = String(p.userId ?? "").trim();
    if (uid) ids.add(uid);
  }
  return ids;
}

export function buildBoxRangeStrategyEmailContent() {
  const subject =
    "[YSTOCK] 실매매 전략 업데이트 — 박스권 v2 (S&P500·코인·Pine PRO)";

  const text = `안녕하세요, YSTOCK입니다.

등록하신 실매매 프로그램에 「박스권 (1h·4h·일)」 시나리오 v2가 일괄 적용되었습니다.
아래 내용을 꼭 읽어 주시고, 앱에서 보유·거래 내역·박스권 탭을 확인해 주세요.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 무엇이 바뀌었나요?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 모든 실매매·시뮬 프로그램의 전략 모델이 「박스권 (1h·4h·일)」로 통일되었습니다.
· 기존 「추천 점수·ATR 목표/손절 자동매도·매도 관점(단기/중기/장기)」 규칙은 이 전략에서 사용하지 않습니다.
· 박스권 탐지 알고리즘이 TradingView Pine PRO 규칙(시드 폭%·좌우 확장·상하단 터치·병합)과 동일하게 서버에 반영되었습니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 두 가지 매매 트랙 (프로그램 설정에 따라 자동 선택)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【A】 코인(빗썸) — 기존 코인 실매매·시뮬 프로그램
  · 시장: 코인(KRW) · 빗썸 App 연동 실매매
  · 감시: 1시간 / 4시간 / 일봉 각각 독립 박스 (시간봉끼리 합치지 않음)
  · 시세: 빗썸 실시간 시세
  · 매수: 박스 하단 이탈 후, 가격이 박스 중심(중앙)선을 다시 돌파할 때
  · 매도: 해당 박스 lot 기준 — 상단=익절, 하단 재이탈=손절
  · 동시 보유: 「최대 동시 보유」= 동시에 열 수 있는 박스(포지션) 개수

【B】 미국 주식(S&P500) — 미국 시장이 켜진 프로그램
  · 탐지: 30분마다 S&P500 전 종목을 스캔해 박스권 후보를 서버에 저장
  · 매매: 실매매(armed) 프로그램만 자동 매매 (시뮬은 미국 박스 자동매매 없음)
  · 매수: 유효 박스의 중심가 도달 시 텔레그램 알림 후, 중심가에 매수 요청
  · 매도: 매수 시점에 정해진 익절(박스 상단)·손절(박스 하단) 가격으로 체결 기록
  · 종목별·박스별 수량 분리: 같은 종목이라도 박스마다 별도 lot (수동 매도 시 비율 반영)
  · 앱: 실매매 탭 「박스권(S&P500)」에서 종목별 박스 확인·「매매 사용」 체크 가능
  · 실주문: 토스 Open API 연동 설정(TOSS_LIVE_ORDERS_ENABLED) 및 계좌 준비 시 실주문, 미설정 시 체결 기록만


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 박스권 탐지 규칙 (Pine PRO 동일)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 시드: 봉 구간 누적 고저 폭이 TF별 한도(1h 3% / 4h 5% / 1d 15%) 안에서 14봉 이상
· 확장: 시드 구간을 좌·우로 같은 가격대 봉이 이어지는 만큼 확장 (최대 120봉)
· 상·하단: 확장 구간에서 상단·하단 각 2회 이상 터치(박스 높이 12% 허용)
· 병합: 가격 35% 겹침 또는 유사 범위 8%, 시간 5봉 이내면 하나로 정리
· 사용 완료 박스: 매매·청산(또는 수동 미사용 체크)된 박스는 이후 매매에 쓰지 않음


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 앱에서 확인하는 방법
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 거래내역 탭: 빗썸/토스 보유 종목에 「등락」「목표 매도가」「손절가」 표시, 거래 목록 스크롤
· 실매매 → 박스권(S&P500): S&P500 종목별 탐지 박스·매매 사용 여부
· 보유·거래: 프로그램별 박스 상태(idle/armed/보유), 익절·손절 예상가


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 기존 보유·설정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 박스와 무관하게 이미 매수한 종목은 그대로 남을 수 있습니다. 필요 시 직접 정리해 주세요.
· 프로그램별 「1회 매수 금액」「최대 동시 보유」「시뮬 자동 매수」 설정은 유지됩니다.
· 코인 프로그램은 계속 빗썸, 미국 프로그램은 S&P500 카탈로그와 연동됩니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 서비스 개선·안내 (진행 중·예정)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 거래내역·보유 화면 스크롤·가독성 개선 (반영됨)
· 박스권 S&P500 카탈로그·30분 스캔·종목별 파일 저장 (반영됨)
· 박스별 lot 익절/손절·텔레그램 중심가 알림 (반영됨)
· 토스 미국 주식 실주문 API — 공식 스펙 확정 후 단계적 연동 예정
· 서버 안정성: 자동 배포·로그 모니터링 지속 개선
· 문의·피드백: 앱 내 「문의」 — 박스 미표시·매매 오동작 시 종목·시간봉·스크린샷을 알려주시면 빠르게 확인합니다


문의는 앱 내 「문의」 또는 관리자에게 연락해 주세요.

감사합니다.
YSTOCK · 시나리오 v${BOX_RANGE_SCENARIO_VERSION}`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.7;color:#1a1a1a;max-width:680px;margin:0 auto;padding:24px;">
<p>안녕하세요, <strong>YSTOCK</strong>입니다.</p>
<p>등록하신 <strong>실매매 프로그램</strong>에 「박스권 (1h·4h·일)」 <strong>시나리오 v2</strong>가 일괄 적용되었습니다.</p>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">1. 변경 요약</h2>
<ul>
<li>모든 실매매·시뮬 프로그램 → <strong>박스권 (1h·4h·일)</strong> 단일 전략</li>
<li>추천 점수·ATR 자동 목표/손절·매도 관점 — <strong>미사용</strong></li>
<li>탐지 로직 = TradingView <strong>Pine PRO</strong> (폭% 시드·좌우 확장·터치·병합)</li>
</ul>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">2. 매매 트랙</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.92em;margin:12px 0;" cellpadding="8">
<tr style="background:#f1f5f9;"><th align="left">구분</th><th align="left">코인(빗썸)</th><th align="left">미국(S&P500)</th></tr>
<tr><td><strong>대상</strong></td><td>코인 시장 프로그램</td><td>미국 시장 프로그램</td></tr>
<tr><td><strong>탐지</strong></td><td>실시간 1h/4h/1d</td><td>30분마다 S&P500 전 종목 스캔·저장</td></tr>
<tr><td><strong>매수</strong></td><td>하단 이탈 → 중심선 재돌파</td><td>유효 박스 중심가 + 텔레그램 알림</td></tr>
<tr><td><strong>매도</strong></td><td>박스 상단 익절 / 하단 손절 (lot별)</td><td>동일 (박스별 수량)</td></tr>
<tr><td><strong>실매매</strong></td><td>빗썸 App 연동</td><td>armed만 · 토스 연동 시 실주문</td></tr>
</table>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">3. Pine PRO 탐지 (공통)</h2>
<ul>
<li>TF별 최대 폭: 1h <strong>3%</strong> · 4h <strong>5%</strong> · 1d <strong>15%</strong> (14봉 이상)</li>
<li>좌·우 확장 최대 120봉 · 상·하단 각 2회 터치(12%)</li>
<li>사용 완료·수동 미사용 박스는 재매매 제외</li>
</ul>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">4. 앱 확인</h2>
<ul>
<li><strong>거래내역</strong>: 등락·목표 매도가·손절가·목록 스크롤</li>
<li><strong>실매매 → 박스권(S&P500)</strong>: 종목별 박스·매매 사용 체크</li>
<li><strong>보유</strong>: 박스 상태·익절/손절 예상가</li>
</ul>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">5. 기존 보유</h2>
<p style="color:#444;">박스와 무관한 기존 체결은 유지될 수 있습니다. 1회 매수 금액·최대 보유·시뮬 설정은 그대로입니다.</p>

<h2 style="font-size:1.15em;border-bottom:2px solid #2563eb;padding-bottom:8px;color:#1e40af;">6. 개선·로드맵</h2>
<ul>
<li>UI: 거래내역 스크롤·보유 TP/SL 표시 <em>(반영)</em></li>
<li>S&P500 카탈로그 30분 스캔 <em>(반영)</em></li>
<li>박스별 lot·텔레그램 중심가 알림 <em>(반영)</em></li>
<li>토스 미국 실주문 — API 확정 후 단계 연동 <em>(예정)</em></li>
<li>안정성·모니터링 지속 개선</li>
</ul>
<p>문의: 앱 내 「문의」 (종목·TF·스크린샷 첨부 권장)</p>
<p style="margin-top:32px;color:#888;font-size:0.9em;">YSTOCK · 박스권 시나리오 v${BOX_RANGE_SCENARIO_VERSION}</p>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * @param {{ dryRun?: boolean; force?: boolean; delayMs?: number; allMembers?: boolean }} [opts]
 */
export async function sendBoxRangeStrategyEmailToLiveTradeUsers(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const allMembers = opts.allMembers !== false;
  const delayMs = Number(opts.delayMs ?? 450);
  const gap =
    Number.isFinite(delayMs) && delayMs >= 0 ? Math.min(delayMs, 10_000) : 450;

  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error(
      "SMTP가 설정되지 않았습니다. .env에 SMTP_HOST 등을 넣거나 EMAIL_VERIFY_MOCK=1 로 테스트하세요.",
    );
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const { subject, text, html } = buildBoxRangeStrategyEmailContent();
  const liveTradeUserIds = listLiveTradeUserIdsSync();
  const users = listUsersSync();
  const log = readSentLogSync();

  /** @type {{ email: string; userId: string; status: string; error?: string }[]} */
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    if (!allMembers && !liveTradeUserIds.has(user.id)) {
      skipped++;
      results.push({ email: "", userId: user.id, status: "no_live_trade_program" });
      continue;
    }

    const to = getUserNotificationEmailSync(user);
    if (!to) {
      skipped++;
      results.push({ email: "", userId: user.id, status: "no_verified_email" });
      continue;
    }
    if (!force && log.sent[to]) {
      skipped++;
      results.push({ email: to, userId: user.id, status: "already_sent" });
      continue;
    }

    if (dryRun) {
      sent++;
      results.push({ email: to, userId: user.id, status: "dry_run" });
      continue;
    }

    try {
      await sendTransactionalEmail({ to, subject, text, html });
      log.sent[to] = { atMs: Date.now(), userId: user.id, campaignId: CAMPAIGN_ID };
      writeSentLogSync(log);
      sent++;
      results.push({ email: to, userId: user.id, status: "sent" });
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ email: to, userId: user.id, status: "failed", error: msg });
    }
  }

  return {
    campaignId: CAMPAIGN_ID,
    dryRun,
    force,
    liveTradeUsers: liveTradeUserIds.size,
    totalUsers: users.length,
    sent,
    skipped,
    failed,
    results,
  };
}

/** @deprecated — 전체 가입 회원 */
export async function sendBoxRangeStrategyEmailToAllMembers(opts = {}) {
  return sendBoxRangeStrategyEmailToLiveTradeUsers({
    ...opts,
    allMembers: true,
  });
}
