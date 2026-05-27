#!/usr/bin/env node
/**
 * 박스권 전략 현황 보고서 이메일
 * node scripts/send-box-range-status-report.mjs
 */
import { loadEnvFile }            from "../server/load-env.js";
import { sendTransactionalEmail } from "../server/email-sender.js";

loadEnvFile();

const TO  = "samron3797@gmail.com";
const ts  = new Date().toISOString().slice(0, 16).replace("T", " ");

const CSS = `
body{font-family:-apple-system,Arial,sans-serif;background:#0f0f14;color:#e0e0e0;margin:0;padding:20px;font-size:13px}
h1{color:#7eb8f7;font-size:18px;border-bottom:1px solid #2a3a5c;padding-bottom:8px;margin-bottom:16px}
h2{color:#a0b8d8;font-size:14px;margin:24px 0 8px;border-left:3px solid #3a6a9c;padding-left:10px}
h3{color:#8aaac8;font-size:12px;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
th{background:#1a2235;color:#7a8fa8;text-align:left;padding:7px 10px;border-bottom:1px solid #2a3a5c;font-weight:600}
td{padding:6px 10px;border-bottom:1px solid #151e2e;vertical-align:top}
tr:hover td{background:#13192a}
.ok{color:#5cb85c;font-weight:bold}
.warn{color:#e8a030;font-weight:bold}
.bad{color:#e05050;font-weight:bold}
.tag{display:inline-block;border-radius:3px;padding:1px 6px;font-size:10px;font-weight:600;margin:1px}
.tag-ok{background:#1a4020;color:#5cb85c}
.tag-warn{background:#3a2a10;color:#e8a030}
.tag-new{background:#1a2a50;color:#5090e0}
.tag-fixed{background:#2a1a40;color:#a060e0}
.mono{font-family:monospace;font-size:11px;color:#a0c0e0}
.section{background:#0d1420;border:1px solid #1a2a40;border-radius:6px;padding:14px;margin-bottom:14px}
.flow{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:8px 0}
.flow-box{background:#1a2235;border:1px solid #2a3a5c;border-radius:4px;padding:5px 10px;font-size:11px}
.arrow{color:#4a6a8c;font-size:14px}
.indent{padding-left:16px;color:#8a9ab8;font-size:11px}
`;

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>박스권 전략 현황 보고서</title><style>${CSS}</style></head><body>

<h1>📊 박스권 전략 구현 현황 보고서</h1>
<p style="color:#5a7a9a;font-size:11px">작성: ${ts} · 기준: 최신 서버 코드 (main 브랜치)</p>

<!-- ══ 1. 전체 아키텍처 ══ -->
<h2>1. 전체 아키텍처</h2>
<div class="section">
  <h3>탐지 → 카탈로그 → 매매 흐름</h3>
  <div class="flow">
    <div class="flow-box">📡 30분 스캔<br><span style="color:#5a7a9a;font-size:10px">sp500 / kr / crypto</span></div>
    <span class="arrow">→</span>
    <div class="flow-box">🔍 V1 탐지<br><span class="mono">detect-pro.js</span></div>
    <span class="arrow">→</span>
    <div class="flow-box" style="border-color:#3a6a9c">📁 box-range-catalog-pro<br><span style="color:#5a7a9a;font-size:10px">기존 유지</span></div>
  </div>
  <div class="flow">
    <div class="flow-box">📡 30분 스캔<br><span style="color:#5a7a9a;font-size:10px">동일 러너</span></div>
    <span class="arrow">→</span>
    <div class="flow-box" style="border-color:#a060e0">🔬 V2 탐지<br><span class="mono">box-range-v2-core.js</span></div>
    <span class="arrow">→</span>
    <div class="flow-box" style="border-color:#a060e0">📁 box-range-catalog-v2<br><span style="color:#5a7a9a;font-size:10px">신규 추가</span></div>
  </div>
  <div class="flow">
    <div class="flow-box" style="border-color:#3a6a9c">📁 catalog-pro<br>+ catalog-v2</div>
    <span class="arrow">→</span>
    <div class="flow-box">🔄 catalog-trading-sync<br><span style="color:#5a7a9a;font-size:10px">3초마다 링크</span></div>
    <span class="arrow">→</span>
    <div class="flow-box">⚙️ FSM (runner-fsm.js)<br><span style="color:#5a7a9a;font-size:10px">틱 단위 실행</span></div>
    <span class="arrow">→</span>
    <div class="flow-box">💰 매수/매도<br><span style="color:#5a7a9a;font-size:10px">빗썸/토스</span></div>
  </div>
</div>

<!-- ══ 2. V2 탐지 알고리즘 ══ -->
<h2>2. V2 탐지 알고리즘 <span class="tag tag-new">신규</span></h2>
<div class="section">
  <table>
    <tr><th>항목</th><th>V1 (PRO)</th><th>V2 <span class="tag tag-new">NEW</span></th></tr>
    <tr><td>박스 경계</td><td>종가 88/12 퍼센타일</td><td><b>고가 80% / 저가 20% 퍼센타일</b> (윅 포함)</td></tr>
    <tr><td>중심가(mid)</td><td>VWAP 근사</td><td><b>거래량 POC</b> (가장 많이 거래된 가격대)</td></tr>
    <tr><td>추세 필터</td><td>없음</td><td><b>ER (효율비) ≤ 0.40</b> — 추세 중 쉬어가기 박스 제거</td></tr>
    <tr><td>거절 강도</td><td>터치 횟수 카운트</td><td><b>거래량 × 되돌림 가중 점수 ≥ 0.5</b></td></tr>
    <tr><td>카탈로그 저장</td><td>box-range-catalog-pro</td><td>box-range-catalog-v2</td></tr>
    <tr><td>스캔 주기</td><td>30분</td><td>30분 (PRO와 동시 실행)</td></tr>
    <tr><td>대상</td><td>S&amp;P500 + KR300 + BTC·ETH</td><td>S&amp;P500 + KR300 + BTC·ETH·<b>SOL</b></td></tr>
  </table>
  <p class="indent">※ SOL-USDT 금번 추가 (BOX_RANGE_CRYPTO_HTF_SYMBOLS)</p>
</div>

<!-- ══ 3. FSM 상태 머신 ══ -->
<h2>3. FSM 상태 머신 (모델 ⑩)</h2>
<div class="section">
  <h3>상태 전이도</h3>
  <div class="flow">
    <div class="flow-box"><b>idle</b></div>
    <span class="arrow">→<br><span style="font-size:10px">박스 종료 후<br>price ≤ bottom</span></span>
    <div class="flow-box"><b>armed</b><br><span style="font-size:10px">dipLow 추적</span></div>
    <span class="arrow">→<br><span style="font-size:10px">price ≥ bottom<br>첫 복귀</span></span>
    <div class="flow-box" style="border-color:#a060e0"><b>confirming</b> <span class="tag tag-new">NEW</span><br><span style="font-size:10px">TF 1봉 대기</span></div>
    <span class="arrow">→<br><span style="font-size:10px">TF 경과 후<br>price ≥ bottom</span></span>
    <div class="flow-box"><b>in_position</b></div>
  </div>
  <div class="flow" style="margin-top:6px">
    <div style="font-size:11px;color:#8a9ab8;width:100%">
      ↩ confirming 중 price &lt; bottom → armed 복귀 (가짜 복귀 차단)
    </div>
  </div>
  <table style="margin-top:12px">
    <tr><th>타임프레임</th><th>confirming 최소 대기</th><th>설명</th></tr>
    <tr><td class="mono">1h</td><td><b>1시간</b></td><td>1h 봉 1개 완성 후 진입</td></tr>
    <tr><td class="mono">4h</td><td><b>4시간</b></td><td>4h 봉 1개 완성 후 진입</td></tr>
    <tr><td class="mono">1d</td><td><b>24시간</b></td><td>일봉 1개 완성 후 진입</td></tr>
  </table>
  <p class="indent">※ 이전 구현: 3초 틱 딜레이에 불과 → 이번 수정으로 실제 봉 단위 확인으로 개선</p>

  <h3>매도 조건 (in_position)</h3>
  <table>
    <tr><th>조건</th><th>동작</th></tr>
    <tr><td>price ≥ top</td><td class="ok">TP 익절</td> </tr>
    <tr><td>price ≤ dipLow (이탈 최저점)</td><td class="bad">SL 손절 + 박스 소멸(dead)</td></tr>
  </table>
</div>

<!-- ══ 4. 카탈로그 연결 ══ -->
<h2>4. 실거래 카탈로그 연결 <span class="tag tag-fixed">수정</span></h2>
<div class="section">
  <table>
    <tr><th>구분</th><th>이전</th><th>이후</th></tr>
    <tr>
      <td>catalog-trading-sync</td>
      <td class="bad">PRO 카탈로그만 읽음</td>
      <td class="ok">PRO + V2 카탈로그 둘 다 읽음</td>
    </tr>
    <tr>
      <td>listTradeEligibleCatalogBoxesSync</td>
      <td class="bad">catalogRoot 고정 (PRO)</td>
      <td class="ok">catalogRoot 파라미터 추가</td>
    </tr>
    <tr>
      <td>runner.js tickCatalogProgram</td>
      <td class="bad">PRO 동기화만 호출</td>
      <td class="ok">PRO·V2 동기화 순차 호출</td>
    </tr>
  </table>
  <p class="indent">→ V2로 탐지된 박스가 이제 실제 매매 FSM에 연결됨</p>
</div>

<!-- ══ 5. 백테스트 결과 요약 ══ -->
<h2>5. 백테스트 결과 (11개 모델)</h2>
<div class="section">
  <table>
    <tr><th>모델</th><th>설명</th><th>특징</th></tr>
    <tr><td>①~⑦</td><td>V1 탐지 (PRO)</td><td>기존 88/12 퍼센타일 + VWAP</td></tr>
    <tr><td>⑧</td><td>V2 + 분할익절</td><td>mid 도달 시 50% 익절 + SL→손익분기</td></tr>
    <tr><td>⑨</td><td>V2 + 거래량필터</td><td>이탈봉 거래량 &gt; avgVol×1.5 이면 skip</td></tr>
    <tr><td style="background:#1a2a50"><b>⑩</b></td><td style="background:#1a2a50"><b>V2 + 확인캔들</b> ← <b>현재 서버 적용</b></td><td style="background:#1a2a50">복귀 후 TF 1봉 대기 확인 후 진입</td></tr>
    <tr><td>⑪</td><td>V2 + 전체조합</td><td>⑧+⑨+⑩ 모두 적용</td></tr>
  </table>
  <p class="indent">ETH·SOL·AAPL·GOOGL 1d 기준 모델 ⑩ 점수 100점 (기대수익률·승률·손익비·빈도 종합)</p>
</div>

<!-- ══ 6. 현재 스캔 현황 ══ -->
<h2>6. 오늘 V2 스캔 결과 (${ts})</h2>
<div class="section">
  <table>
    <tr><th>시장</th><th>스캔 종목</th><th>박스 탐지 종목</th><th>총 박스 수</th></tr>
    <tr><td>크립토 (BTC·ETH·SOL)</td><td>3</td><td colspan="2" style="color:#7a8fa8">이메일 참조</td></tr>
    <tr><td>미국 S&amp;P500</td><td>500</td><td colspan="2" style="color:#7a8fa8">별도 이메일 전송됨</td></tr>
    <tr><td>국내 시총 300</td><td>300</td><td colspan="2" style="color:#7a8fa8">별도 이메일 전송됨</td></tr>
    <tr style="background:#1a2235"><td><b>합계</b></td><td><b>803</b></td><td colspan="2"><b>총 32,522개 박스 탐지</b></td></tr>
  </table>
  <p class="indent">※ 스캔 결과는 box-range-catalog-v2/ 에 저장, 30분 주기로 자동 갱신</p>
</div>

<!-- ══ 7. 변경 이력 ══ -->
<h2>7. 이번 세션 변경 이력</h2>
<div class="section">
  <table>
    <tr><th>커밋</th><th>내용</th></tr>
    <tr><td class="mono">ec647a4</td><td>모델 ⑩ 서버 구현 — V2 탐지 함수 + confirming 상태 FSM (1차)</td></tr>
    <tr><td class="mono">86066b1</td><td>V2 스캔 인프라 — SOL 추가, scanOneSymbolCatalogV2, 러너 3개 수정</td></tr>
    <tr><td class="mono">4a4fc8f</td><td>V2 실거래 연결 완성 — confirmingAtMs TF 대기, catalog 파라미터, runner 양방향 동기화</td></tr>
  </table>
</div>

<p style="color:#3a4a5c;font-size:11px;margin-top:30px;border-top:1px solid #1a2235;padding-top:12px">
YSTOCK 박스권 전략 보고서 · ${ts}
</p>
</body></html>`;

const subject = `[YSTOCK] 박스권 전략 현황 보고서 (${ts})`;
const text = `[YSTOCK] 박스권 전략 현황 보고서 (${ts})

아키텍처: V1(PRO) + V2 탐지 병렬 스캔 → 각자 카탈로그 저장 → 동일 FSM 연결
모델: 모델 ⑩ (V2탐지 + 확인캔들) 서버 적용 완료
확인캔들: 1h=1시간, 4h=4시간, 1d=24시간 대기 후 매수
SOL-USDT 크립토 스캔 대상 추가
오늘 스캔: 803종목, 32,522개 박스 탐지
`;

await sendTransactionalEmail({ to: TO, subject, text, html });
console.log(`✓ 보고서 이메일 → ${TO}`);
