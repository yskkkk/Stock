/**
 * 박스권(1h·4h·1d) 실매매 전략 변경 — 가입 회원 일괄 안내 메일
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  getUserNotificationEmailSync,
  listUsersSync,
} from "../users-store.js";
import { resolveServerDataDir } from "../data-path.js";

const CAMPAIGN_ID = "box-range-strategy-2026-05-26";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function sentLogPath() {
  return path.join(resolveServerDataDir(), ".box-range-strategy-email-sent.json");
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
  fs.writeFileSync(sentLogPath(), JSON.stringify(log, null, 0), "utf8");
}

export function buildBoxRangeStrategyEmailContent() {
  const subject = "[YSTOCK] 실매매 전략 변경 안내 — 박스권(1h·4h·일)";
  const text = `안녕하세요, YSTOCK입니다.

실매매(및 시뮬) 전략이 아래와 같이 변경·통일되었습니다. 실행 중이던 프로그램에도 동일 규칙이 적용됩니다.


■ 변경 요약
· 기존: 추천 스크리너 점수·목표·손절(ATR) 자동 매도 등 모델별 규칙
· 현재: 「박스권 (1h·4h·일)」 단일 전략 — 빗썸 코인 실매매·시뮬 공통


■ 매수 (진입)
· 1시간·4시간·일봉 각각 박스권을 탐지합니다. 시간봉끼리는 합치지 않고, 같은 봉 안에서만 겹치는 박스를 정리합니다.
· 박스 하단을 이탈한 뒤, 가격이 박스 중심선을 다시 돌파할 때 매수합니다.
· 프로그램에 설정한 「최대 동시 보유」는 박스(포지션) 개수 기준입니다.


■ 매도 (청산)
· 박스 상단 도달 → 해당 박스 lot 익절 매도
· 박스 하단 재이탈 → 해당 박스 lot 손절 매도
· 「목표·손절가 자동 매도」「매도 관점(단기·중기·장기)」은 이 전략에 적용되지 않습니다.


■ 적용 범위
· 시장: 코인(빗썸) — App 연동 실매매
· 시간축: 1h / 4h / 1d 각각 독립 감시·매매
· 시세: 빗썸 실시간 시세 기준


■ 참고
· 기존에 보유 중인 종목(박스와 무관한 체결)은 그대로 남을 수 있습니다. 필요 시 보유·거래 내역에서 확인해 주세요.
· 프로그램 설정(1회 매수 금액, 최대 보유 수, 시뮬 자동 매수 등)은 계정별로 유지됩니다.


문의는 앱 내 「문의」 또는 관리자에게 연락해 주세요.

감사합니다.
YSTOCK`;

  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#1a1a1a;max-width:640px;margin:0 auto;padding:24px;">
<p>안녕하세요, <strong>YSTOCK</strong>입니다.</p>
<p>실매매(및 시뮬) 전략이 아래와 같이 <strong>변경·통일</strong>되었습니다. 실행 중이던 프로그램에도 동일 규칙이 적용됩니다.</p>

<h2 style="font-size:1.1em;border-bottom:1px solid #ddd;padding-bottom:6px;">변경 요약</h2>
<ul>
<li><strong>기존</strong>: 추천 스크리너 점수·목표·손절(ATR) 자동 매도 등 모델별 규칙</li>
<li><strong>현재</strong>: 「박스권 (1h·4h·일)」 단일 전략 — 빗썸 코인 실매매·시뮬 공통</li>
</ul>

<h2 style="font-size:1.1em;border-bottom:1px solid #ddd;padding-bottom:6px;">매수 (진입)</h2>
<ul>
<li>1시간·4시간·일봉 각각 박스권 탐지 (시간봉 간 병합 없음, 동일 봉 내 겹침만 정리)</li>
<li>박스 <strong>하단 이탈</strong> 후 <strong>중심선 재돌파</strong> 시 매수</li>
<li>「최대 동시 보유」= 동시에 열 수 있는 <strong>박스 포지션</strong> 수</li>
</ul>

<h2 style="font-size:1.1em;border-bottom:1px solid #ddd;padding-bottom:6px;">매도 (청산)</h2>
<ul>
<li>박스 <strong>상단</strong> 도달 → 해당 lot 익절</li>
<li>박스 <strong>하단</strong> 재이탈 → 해당 lot 손절</li>
<li>목표·손절 자동 매도 / 매도 관점(단기·중기·장기) — <strong>미적용</strong></li>
</ul>

<h2 style="font-size:1.1em;border-bottom:1px solid #ddd;padding-bottom:6px;">적용 범위</h2>
<ul>
<li>시장: 코인(빗썸), App 연동 실매매</li>
<li>시간축: 1h / 4h / 1d 각각 독립</li>
</ul>

<p style="color:#555;font-size:0.95em;">기존 비박스 체결 보유는 그대로일 수 있습니다. 프로그램별 매수 금액·최대 보유·시뮬 설정은 유지됩니다.</p>
<p>문의: 앱 내 「문의」</p>
<p style="margin-top:28px;color:#888;">YSTOCK</p>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * @param {{ dryRun?: boolean; force?: boolean; delayMs?: number }} [opts]
 */
export async function sendBoxRangeStrategyEmailToAllMembers(opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const delayMs = Number(opts.delayMs ?? 400);
  const gap =
    Number.isFinite(delayMs) && delayMs >= 0 ? Math.min(delayMs, 10_000) : 400;

  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error(
      "SMTP가 설정되지 않았습니다. .env에 SMTP_HOST 등을 넣거나 EMAIL_VERIFY_MOCK=1 로 테스트하세요.",
    );
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }

  const { subject, text, html } = buildBoxRangeStrategyEmailContent();
  const users = listUsersSync();
  const log = readSentLogSync();

  /** @type {{ email: string; userId: string; status: string; error?: string }[]} */
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
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
    totalUsers: users.length,
    sent,
    skipped,
    failed,
    results,
  };
}
