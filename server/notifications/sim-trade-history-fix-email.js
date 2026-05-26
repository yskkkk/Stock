/**
 * 시뮬 거래내역 — 수량·손익 표시 수정 안내 메일
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";

export const SIM_TRADE_HISTORY_FIX_VERSION = "2026-05-26-sim-pnl-1";
export const DEFAULT_SIM_TRADE_FIX_TO = "samron3@naver.com";

export function buildSimTradeHistoryFixReportContent() {
  const subject = `[YSTOCK] 시뮬 거래내역 수량·손익 수정 (${SIM_TRADE_HISTORY_FIX_VERSION})`;

  const text = `YSTOCK — 시뮬 거래내역 표시 수정 (${SIM_TRADE_HISTORY_FIX_VERSION})

■ 증상
· 수량 소수 자릿수가 어색하게 보임
· 실제 손실인데 수익(+)으로 표시되는 경우

■ 원인
1) 실현 손익 계산 시 매도 체결의 entryPrice(박스 중심가·목표 진입가 등)를 매입 단가로 사용
   → 실제 매수 원가보다 낮게 잡히면 손실도 이익으로 표시됨
2) 매도 수수료를 부분 매도 시에도 전액 차감하던 오류
3) 미국 주식 수량을 정수로만 표시 (소수 주 미표시)

■ 수정 (코드)
· src/lib/liveTradeBuySellPrices.ts
  - 손익·매입가: 선행 매수의 가중 평균 원가(수수료 포함)만 사용
  - proceeds = 매도수량×체결가 − 비례 매도수수료
· src/lib/format.ts — US 수량 최대 4자리 소수
· server/live-trade-portfolio-store.js — 저장 시 시장별 수량 정규화

■ 확인 방법
1) 앱 새로고침 후 거래내역 → 시뮬레이션
2) 매도 행: 실현손익 부호가 (매도가−평균매입가)×수량 과 일치하는지
3) 이미 저장된 과거 체결도 화면 재계산으로 표시만 바뀜 (JSON 원장은 그대로)

■ 참고
· 총 수익률(프로그램 탭)은 원래 평균 원가 기준이었고, 거래내역 표만 어긋나 있었습니다.

— YSTOCK
`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/></head>
<body style="font-family:Malgun Gothic,sans-serif;line-height:1.65;color:#111;max-width:640px;">
<h1>시뮬 거래내역 — 수량·손익 수정</h1>
<p><strong>${SIM_TRADE_HISTORY_FIX_VERSION}</strong></p>

<h2>증상</h2>
<ul>
<li>수량 소수 표기 이상</li>
<li><strong>손실인데 수익(+)</strong>으로 보임</li>
</ul>

<h2>원인</h2>
<ol>
<li>매도 행의 <code>entryPrice</code>(박스 중심가 등)를 매입 단가로 써서 원가가 낮게 잡힘</li>
<li>부분 매도 시 매도 수수료 전액 차감</li>
<li>미국 주식 수량 정수만 표시</li>
</ol>

<h2>수정</h2>
<ul>
<li>손익 = (매도가−<strong>실제 평균 매입가</strong>)×수량 − 수수료</li>
<li>US 수량 소수 4자리까지</li>
<li>저장 시 수량 정규화</li>
</ul>

<p>앱 새로고침 후 시뮬 거래내역에서 확인해 주세요.</p>
</body></html>`;

  return { subject, text, html };
}

export async function sendSimTradeHistoryFixReportEmail(opts = {}) {
  const to = String(opts.to ?? DEFAULT_SIM_TRADE_FIX_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error("SMTP 미설정");
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildSimTradeHistoryFixReportContent();
  if (dryRun) return { to, dryRun: true, subject: payload.subject };
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject };
}
