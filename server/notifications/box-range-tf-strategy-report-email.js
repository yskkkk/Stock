/**
 * 박스권 PRO v2 — 1h / 4h / 1d 매매·탐지 전략 상세 보고서 메일
 */
import { sendTransactionalEmail, isEmailSendingConfigured } from "../email-sender.js";
import {
  BOX_RANGE_MAX_PCT,
  BOX_RANGE_MIN_PCT,
  BOX_RANGE_PRO_SPLIT_MID_PCT,
  BOX_RANGE_CRYPTO_HTF_SYMBOLS,
  BOX_RANGE_SP500_SCAN_MS,
  BOX_RANGE_KR_SCAN_MS,
  BOX_RANGE_CRYPTO_SCAN_MS,
  BOX_RANGE_PRO_MIN_REJECTIONS,
  BOX_RANGE_TOUCH_THRESHOLD,
  BOX_RANGE_MIN_BARS,
  BOX_RANGE_MAX_EXPAND_BARS,
  BOX_RANGE_PRO_MERGE_MID_PCT,
  BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT,
  BOX_RANGE_MODEL_ID,
} from "../box-range/constants.js";
import { BOX_RANGE_SCENARIO_VERSION } from "../box-range/migrate-active-programs.js";

export const BOX_RANGE_TF_REPORT_VERSION = "2026-05-27-tf-strategy-1";
export const DEFAULT_BOX_RANGE_TF_REPORT_TO = "samron3@naver.com";

function pctRow(tf) {
  return {
    tf,
    maxPct: BOX_RANGE_MAX_PCT[tf],
    minPct: BOX_RANGE_MIN_PCT[tf],
    splitMid: BOX_RANGE_PRO_SPLIT_MID_PCT[tf],
  };
}

const TF_ROWS = /** @type {const} */ (["1h", "4h", "1d"]).map(pctRow);

function scanMinLabel(ms) {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.round(m / 60)}시간` : `${m}분`;
}

export function buildBoxRangeTfStrategyReportContent() {
  const subject = `[YSTOCK] 박스권 1h·4h·1d 매매 전략 상세 보고서 (${BOX_RANGE_TF_REPORT_VERSION})`;
  const scenario = BOX_RANGE_SCENARIO_VERSION;

  const tfTableText = TF_ROWS.map(
    (r) =>
      `  ${r.tf}  |  최대 폭 ${r.maxPct}%  |  최소 폭 ${r.minPct}%  |  확장 중단(중심이탈) ${r.splitMid}%`,
  ).join("\n");

  const text = `YSTOCK 박스권 PRO v2 — 1시간 / 4시간 / 1일 매매 전략 상세 보고서
작성 기준: 서버 코드 SSOT (runner-fsm.js, box-range-pro-core.js, constants.js)
보고서 버전: ${BOX_RANGE_TF_REPORT_VERSION}
시나리오 버전: v${scenario}
모델 ID: ${BOX_RANGE_MODEL_ID} (박스권 1h·4h·일)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
요약
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

· 실매매·시뮬 프로그램의 매매 규칙은 1h / 4h / 1d 모두 동일합니다(FSM 동일).
· 시간봉별 차이는 「박스를 어떻게 찾느냐(탐지 파라미터)」와 「어느 시장·어떤 주기로 스캔하느냐」입니다.
· 매수: 박스 기간(rightTime) 종료 후, 가격이 하단 이하로 이탈했다가 하단 위로 복귀할 때 (진입가=하단).
· 익절: 상단(top) 도달 시 매도 후 같은 박스에서 재진입 가능(idle 복귀).
· 손절: 이탈 구간 최저가(dipLow) 재도달 시 매도 → 해당 박스 dead(재진입 금지).
· 추천 점수·ATR 목표/손절·매도 관점(단기/중기)은 이 전략에서 사용하지 않습니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 시간봉별 탐지 파라미터 (PRO v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

박스 「전체 높이」% = (상단−하단) / ((상단+하단)/2) × 100

${tfTableText}

공통(1h·4h·1d 동일):
  · 최소 봉 수: ${BOX_RANGE_MIN_BARS}봉 이상 시드
  · 좌·우 확장: 최대 ${BOX_RANGE_MAX_EXPAND_BARS}봉, 가격대 연속 봉만 확장
  · 상·하단 거절: 각 ${BOX_RANGE_PRO_MIN_REJECTIONS}회 이상 (터치 폭=박스 높이의 ${Math.round(BOX_RANGE_TOUCH_THRESHOLD * 100)}%)
  · 병합: 시간 5봉 이내 + 중심가 차 ${BOX_RANGE_PRO_MERGE_MID_PCT}% 이내 + 높이 차 ${BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT}% 이내
  · 카탈로그 SSOT: server/.data/box-range-catalog-pro/
  · UI 「박스권」 탭 기본 전략: PRO v2 (Legacy는 별도, 최소 폭 필터 미적용 데이터 잔존 가능)

※ 앱 카드의 TP/SL 옆 %는 「중심→상/하」 거리이므로, 전체 박스 폭의 약 절반으로 보일 수 있습니다.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 매매 FSM (1h·4h·1d 공통 — runner-fsm.js)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

상태: idle → armed → in_position → (익절 시 idle / 손절 시 closed+dead)

[idle]
  조건: 박스 rightTime(종료 시각) 이후
  트리거: lastPrice ≤ bottom → armed, breakAtMs·dipLow 기록

[armed]
  · 이탈 중 dipLow(최저가) 갱신 — 손절 기준가
  · lastPrice ≥ bottom → 매수 시도
      - 진입가(기록): bottom
      - 목표 매도: top
      - 손절가: dipLow (이탈 구간 최저)
  · maxOpenPositions 초과 시 매수 보류
  · armed 실매매만 거래소 주문(빗썸/토스), sim은 시뮬 체결

[in_position]
  · lastPrice ≥ top → 익절(TP), 포지션 정리 후 idle (동일 박스 재진입 허용)
  · lastPrice ≤ dipLow → 손절(SL), dead=true, 박스 closed·카탈로그 consumed

시세 판정: 종가가 아닌 실시간 lastPrice(틱 약 ${process.env.STOCK_BOX_RANGE_TICK_MS ?? "3000"}ms 주기 폴링)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 시장·시간봉별 운영 경로
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【코인 — 빗썸 KRW】
  · 대상: ${BOX_RANGE_CRYPTO_HTF_SYMBOLS.join(", ")} 만 1h/4h/1d
  · 탐지: 프로그램 틱마다 실시간 봉 로드 → PRO 탐지 → state 등록
  · 카탈로그: ${scanMinLabel(BOX_RANGE_CRYPTO_SCAN_MS)}마다 PRO 스캔·파일 갱신 후 프로그램에 연결
  · 실매매: 빗썸 App API (회원별 키)

【미국 S&P500】
  · 탐지·저장: ${scanMinLabel(BOX_RANGE_SP500_SCAN_MS)}마다 전 종목 PRO 스캔 → catalog-pro/us/
  · 매매: armed/sim 프로그램이 카탈로그 박스를 tick당 최대 20개씩 state에 연결 후 FSM
  · 실주문: 토스 API(회원 키) + TOSS_LIVE_ORDERS_ENABLED

【국내 KOSPI·KOSDAQ】
  · 미국과 동일 구조, 스캔 주기 ${scanMinLabel(BOX_RANGE_KR_SCAN_MS)}, catalog-pro/kr/

※ 1h·4h·1d는 같은 종목에서 각각 독립 박스·독립 포지션 슬롯으로 동작(봉끼리 합치지 않음).


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 프로그램 설정이 전략에 미치는 영향
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  · 1회 매수 금액 (KRW/USD): 포지션 크기
  · 최대 동시 보유(maxOpenPositions): 동시에 열 수 있는 박스(포지션) 개수 — TF 합산
  · 시장 토글: kr / us / crypto (복수 선택 가능)
  · 상태: armed=실매매, sim=시뮬, paused=미동작
  · simAutoBuy: 시뮬 자동 매수 on/off

미사용(박스권 전략): minScoreRatio, takeProfitPct, stopLossPct, sellHorizon, ATR 자동매도


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 참고·주의
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  · Legacy 카탈로그(box-range-catalog)는 overlap-merge 구버전 — PRO와 별도
  · 손절 후 dead 박스는 재매매 안 함 / 익절 후에는 같은 박스 재진입 가능
  · 카탈로그 consumed·수동 미사용 박스는 이후 매매 제외
  · 박스권 텔레그램: 근접(STOCK_BOX_RANGE_NEAR_TELEGRAM) 기본 ON, 스캔 요약(STOCK_BOX_RANGE_SCAN_TELEGRAM) 기본 OFF

문의: 앱 내 「문의」 — 종목·시간봉·스크린샷 첨부 권장

— YSTOCK 운영 · 자동 생성 보고서`;

  const tfTableHtml = TF_ROWS.map(
    (r) =>
      `<tr><td><strong>${r.tf}</strong></td><td>${r.maxPct}%</td><td>${r.minPct}%</td><td>${r.splitMid}%</td></tr>`,
  ).join("");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;line-height:1.65;color:#111;max-width:820px;margin:0 auto;padding:24px;">
<h1 style="font-size:1.25em;color:#1e40af;border-bottom:2px solid #2563eb;padding-bottom:8px;">박스권 1h · 4h · 1d 매매 전략 상세 보고서</h1>
<p style="color:#64748b;font-size:0.92em;">버전 <code>${BOX_RANGE_TF_REPORT_VERSION}</code> · 시나리오 v${scenario} · 코드 SSOT 기준</p>

<h2 style="font-size:1.1em;color:#1e40af;">요약</h2>
<ul>
<li><strong>매매 규칙</strong>은 1h/4h/1d <strong>동일</strong>(하단 이탈→복귀 매수, 상단 익절, dipLow 손절).</li>
<li>시간봉별 차이는 <strong>탐지 폭·최소 높이·확장 중단</strong>과 <strong>스캔 주기</strong>입니다.</li>
<li>추천 점수·ATR·매도 관점 — <strong>미사용</strong>.</li>
</ul>

<h2 style="font-size:1.1em;color:#1e40af;">1. 시간봉별 탐지 파라미터</h2>
<p>박스 전체 높이% = (상−하) / 중간가 × 100</p>
<table style="width:100%;border-collapse:collapse;font-size:0.92em;margin:12px 0;" cellpadding="8" border="1">
<thead style="background:#f1f5f9;"><tr><th>봉</th><th>최대 폭</th><th>최소 폭</th><th>확장 중단(중심이탈)</th></tr></thead>
<tbody>${tfTableHtml}</tbody>
</table>
<p style="font-size:0.9em;color:#444;">공통: 최소 ${BOX_RANGE_MIN_BARS}봉 · 확장 최대 ${BOX_RANGE_MAX_EXPAND_BARS}봉 · 상·하 거절 각 ${BOX_RANGE_PRO_MIN_REJECTIONS}회 · 병합(중심 ${BOX_RANGE_PRO_MERGE_MID_PCT}%, 높이차 ${BOX_RANGE_PRO_MERGE_HEIGHT_DIFF_PCT}%)</p>
<p style="font-size:0.9em;color:#b45309;">앱 TP/SL 옆 %는 중심→상·하 거리라 전체 폭의 약 절반으로 보일 수 있습니다.</p>

<h2 style="font-size:1.1em;color:#1e40af;">2. 매매 FSM (공통)</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.92em;" cellpadding="8" border="1">
<thead style="background:#f1f5f9;"><tr><th>상태</th><th>동작</th></tr></thead>
<tbody>
<tr><td><code>idle</code></td><td>박스 종료 후 가격 ≤ 하단 → <code>armed</code></td></tr>
<tr><td><code>armed</code></td><td>dipLow 갱신 · 가격 ≥ 하단 → <strong>매수</strong>(진입=하단, TP=상단, SL=dipLow)</td></tr>
<tr><td><code>in_position</code></td><td>≥ 상단 → <strong>익절</strong> 후 idle(재진입 가능) · ≤ dipLow → <strong>손절</strong> 후 dead·closed</td></tr>
</tbody>
</table>

<h2 style="font-size:1.1em;color:#1e40af;">3. 시장별 운영</h2>
<table style="width:100%;border-collapse:collapse;font-size:0.92em;" cellpadding="8" border="1">
<thead style="background:#f1f5f9;"><tr><th>시장</th><th>대상·스캔</th><th>실매매</th></tr></thead>
<tbody>
<tr><td>코인</td><td>${BOX_RANGE_CRYPTO_HTF_SYMBOLS.join(", ")} · 실시간 탐지 + ${scanMinLabel(BOX_RANGE_CRYPTO_SCAN_MS)} 카탈로그</td><td>빗썸</td></tr>
<tr><td>미국</td><td>S&P500 · ${scanMinLabel(BOX_RANGE_SP500_SCAN_MS)} 스캔</td><td>토스(조건부)</td></tr>
<tr><td>국내</td><td>KOSPI/KOSDAQ · ${scanMinLabel(BOX_RANGE_KR_SCAN_MS)} 스캔</td><td>토스(조건부)</td></tr>
</tbody>
</table>
<p>동일 종목의 1h·4h·1d 박스는 <strong>독립</strong>으로 매매됩니다.</p>

<h2 style="font-size:1.1em;color:#1e40af;">4. 프로그램 설정</h2>
<ul>
<li>1회 매수 금액 · 최대 동시 보유 · 시장(kr/us/crypto) · armed/sim</li>
</ul>

<h2 style="font-size:1.1em;color:#1e40af;">5. 주의</h2>
<ul>
<li>Legacy 카탈로그는 PRO와 별도 규칙</li>
<li>손절 1회 → 박스 소멸 / 익절 → 재진입 가능</li>
</ul>

<p style="margin-top:28px;color:#888;font-size:0.88em;">YSTOCK · ${BOX_RANGE_TF_REPORT_VERSION}</p>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * @param {{ to?: string; dryRun?: boolean }} [opts]
 */
export async function sendBoxRangeTfStrategyReportEmail(opts = {}) {
  const to = String(opts?.to ?? DEFAULT_BOX_RANGE_TF_REPORT_TO).trim();
  if (!to) throw new Error("수신 이메일 필요");
  const dryRun = Boolean(opts?.dryRun);
  if (!dryRun && !isEmailSendingConfigured()) {
    const err = new Error(
      "SMTP가 설정되지 않았습니다. .env에 SMTP_HOST 등을 설정하거나 EMAIL_VERIFY_MOCK=1 로 테스트하세요.",
    );
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  const payload = buildBoxRangeTfStrategyReportContent();
  if (dryRun) {
    return { to, dryRun: true, subject: payload.subject };
  }
  await sendTransactionalEmail({
    to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
  return { to, dryRun: false, sent: true, subject: payload.subject };
}
