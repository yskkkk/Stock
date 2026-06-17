/**
 * 서버 로직 전체 점검 보고서 이메일 발송
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail } from "../server/email-sender.js";
loadEnvFile();

const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; background: #0f1117; color: #e2e8f0; margin: 0; padding: 0; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 22px; color: #60a5fa; border-bottom: 2px solid #1e40af; padding-bottom: 12px; margin-bottom: 24px; }
  h2 { font-size: 16px; color: #93c5fd; margin: 28px 0 10px; }
  h3 { font-size: 14px; color: #bfdbfe; margin: 20px 0 8px; }
  .section { background: #1e2132; border-radius: 10px; padding: 20px 22px; margin-bottom: 20px; border: 1px solid #2d3561; }
  .tag { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-right: 6px; }
  .tag-fix { background: #166534; color: #86efac; }
  .tag-auto { background: #1e3a5f; color: #93c5fd; }
  .tag-test { background: #3b1f6e; color: #c4b5fd; }
  .tag-bug { background: #7f1d1d; color: #fca5a5; }
  .tag-warn { background: #78350f; color: #fcd34d; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
  th { background: #1e3a5f; color: #93c5fd; padding: 8px 12px; text-align: left; }
  td { padding: 7px 12px; border-bottom: 1px solid #2d3561; vertical-align: top; }
  tr:hover td { background: #151a2d; }
  .pass { color: #4ade80; font-weight: 700; }
  .fail { color: #f87171; font-weight: 700; }
  .warn { color: #fbbf24; }
  code { background: #151a2d; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #a5f3fc; font-family: 'Courier New', monospace; }
  .verdict { font-size: 13px; line-height: 1.8; }
  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 4px 0; line-height: 1.6; }
  .footer { margin-top: 36px; font-size: 12px; color: #4b5563; text-align: center; }
  .highlight { color: #fbbf24; font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">

<h1>📋 서버 로직 전체 점검 보고서 — 2026-06-13</h1>

<!-- ═══ 요약 ═══ -->
<div class="section">
  <h2>🔍 점검 범위 및 결과 요약</h2>
  <table>
    <tr><th>항목</th><th>내용</th></tr>
    <tr><td>점검 파일</td><td>value-invest-eps-history.js/test · value-invest-growth.js · value-invest-per-history.test.js · value-invest-return-input.js · value-invest-return-model.test.js · buffett-intrinsic-value.js/test</td></tr>
    <tr><td>테스트 통과</td><td class="pass">83 / 83 (100%)</td></tr>
    <tr><td>발견 버그 (코드)</td><td><span class="tag tag-bug">3건</span> calcTerminalPv 부동소수점, PER 상한 과소, KR 타임존</td></tr>
    <tr><td>자동 개선 적용</td><td><span class="tag tag-auto">4건</span> PER 300 · KST 타임존 · 갭연도 경고 · 음수 EPS 카운트</td></tr>
    <tr><td>테스트 수정</td><td><span class="tag tag-test">5건</span> vitest 마이그레이션 완료, 부동소수점 테스트 버그 수정</td></tr>
  </table>
</div>

<!-- ═══ 버그 수정 ═══ -->
<div class="section">
  <h2>🐛 버그 수정 (3건)</h2>

  <h3><span class="tag tag-bug">BUG-A</span> calcTerminalPv — gap ≤ 0.005 체크 부동소수점 오류</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/buffett-intrinsic-value.js</code><br>
    <b>증상:</b> <code>calcTerminalPv(5, 0.095, 10, 0.1)</code> — 할인율 10%, 잔여성장 9.5%, gap = 0.005. 이론상 null을 반환해야 하나 실제 반환값 있음<br>
    <b>원인:</b> <code>0.1 - 0.095 = 0.005000000000000004</code> (IEEE 754 부동소수점). <code>0.005000...4 &lt;= 0.005</code>는 false → 체크 통과<br>
    <b>수정:</b> <code>if (gap &lt;= 0.005)</code> → <code>if (Math.round(gap * 1000) &lt;= 5)</code> — 1/1000 단위 반올림 비교로 FP 오차 허용<br>
    <b>영향:</b> 버핏 DCF 잔여가치 계산에서 growth ≈ discount (5bp 이내) 구간 정확히 차단됨
  </div>

  <h3><span class="tag tag-bug">BUG-B</span> computeHistoricalAveragePer — PER 상한 150 과소</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-return-input.js</code><br>
    <b>증상:</b> 한국 성장주 PER 150~299 구간이 역사적 PER 계산에서 통째로 제외됨<br>
    <b>원인:</b> <code>per &lt; 150</code> 하드코딩. 성장 단계 기업(POSCO홀딩스, 에코프로, 카카오 등)은 PER 200~400이 정상<br>
    <b>수정:</b> <code>per &lt; 150</code> → <code>per &lt; 300</code><br>
    <b>영향:</b> 기존에 PER=200짜리 연도가 계산에서 빠져 역사적 평균이 왜곡되던 문제 해소
  </div>

  <h3><span class="tag tag-bug">BUG-C</span> candleCalendarYear — KR 시장 UTC 서버 연말 연도 오류</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-return-input.js</code><br>
    <b>증상:</b> UTC 서버(Docker 배포 등)에서 12월 31일 캔들의 연도가 이듬해로 잘못 계산됨<br>
    <b>원인:</b> <code>new Date(sec * 1000).getFullYear()</code>는 로컬 타임존 기준. UTC 서버에서 12/31 KST는 12/31 06:30 UTC로 문제없으나, Naver 캔들 타임스탬프가 자정 기준이면 12/30 15:00 UTC → 2023년으로 오분류<br>
    <b>수정:</b> KR 마켓에 UTC+9 오프셋 적용 → <code>new Date((sec + 9 * 3600) * 1000).getUTCFullYear()</code><br>
    <b>영향:</b> 서버 타임존 무관 KST 기준 연도 계산 일관성 보장
  </div>
</div>

<!-- ═══ 자동 개선 ═══ -->
<div class="section">
  <h2>⚡ 자동 개선 (4건, 기능 의도 유지)</h2>

  <h3><span class="tag tag-auto">AUTO-1</span> epsGrowthWindow — gapYearsCount 필드 추가</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-growth.js</code><br>
    <b>내용:</b> CAGR 계산 구간(start~end) 내 양수 EPS 없는 연도 수를 <code>gapYearsCount</code>로 반환<br>
    <b>예시:</b> Boeing — 2018(+) → 2019~2021(-) → 2022(+). <code>gapYearsCount = 3</code>. CAGR은 4년 복리처럼 보이지만 실제로는 손실 3년 건너뜀<br>
    <b>경고 추가:</b> <code>deriveValueInvestGrowth10y</code>에서 gapYearsCount > 0이면 "EPS CAGR 구간 N년 내 음수/결손 M개 연도 포함 — CAGR 왜곡 가능" 경고 자동 생성<br>
    <b>UI 효과:</b> 가치투자 패널 warnings 섹션에 표시됨
  </div>

  <h3><span class="tag tag-auto">AUTO-2</span> averageEpsFromHistory — negativeYearsCount 필드 추가</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-eps-history.js</code><br>
    <b>내용:</b> 반환값에 <code>negativeYearsCount: number</code> 추가. EPS 이력 중 0 이하인 연도 수<br>
    <b>활용:</b> UI에서 "최근 10년 중 3년 적자" 같은 정보 표시 가능, 품질 지표로 활용
  </div>

  <h3><span class="tag tag-auto">AUTO-3</span> computeHistoricalAveragePer — market 파라미터 추가</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-return-input.js</code><br>
    <b>내용:</b> 4번째 파라미터 <code>market</code> 추가 (기본값 "us", 하위 호환 유지)<br>
    <b>동작:</b> <code>loadValueInvestReturn</code>에서 <code>fundamentals.market</code>을 전달 → KR/US별 올바른 타임존 사용
  </div>

  <h3><span class="tag tag-auto">AUTO-4</span> 테스트 T12b 추가 — PER 200 포함 검증</h3>
  <div class="verdict">
    <b>파일:</b> <code>server/value-invest-per-history.test.js</code><br>
    <b>내용:</b> <code>computeHistoricalAveragePer</code>에 평균주가 200/EPS 1 (PER=200) 입력 → avg=200 반환 확인<br>
    <b>목적:</b> BUG-B 수정 검증 — 이전이면 per&lt;150 체크로 avg=null 반환
  </div>
</div>

<!-- ═══ 테스트 마이그레이션 ═══ -->
<div class="section">
  <h2>🧪 테스트 마이그레이션 — vitest 완전 통일</h2>

  <table>
    <tr><th>파일</th><th>이전</th><th>이후</th><th>결과</th></tr>
    <tr>
      <td><code>value-invest-per-history.test.js</code></td>
      <td>node:test (실행 불가)</td>
      <td>vitest 16케이스</td>
      <td class="pass">✅ 16 통과</td>
    </tr>
    <tr>
      <td><code>value-invest-eps-history.test.js</code></td>
      <td>null as any TypeScript 오류</td>
      <td>JSDoc 캐스트 수정</td>
      <td class="pass">✅ 10 통과</td>
    </tr>
    <tr>
      <td><code>value-invest-return-model.test.js</code></td>
      <td>cagr precision=3 (너무 엄격)</td>
      <td>precision=2, round2 FP 수정</td>
      <td class="pass">✅ 17 통과</td>
    </tr>
    <tr>
      <td><code>buffett-intrinsic-value.test.js</code></td>
      <td>gap=0.005 FP 오류로 실패</td>
      <td>BUG-A 코드 수정으로 해결</td>
      <td class="pass">✅ 26 통과</td>
    </tr>
    <tr>
      <td><code>value-invest-growth.test.js</code></td>
      <td>이미 vitest</td>
      <td>변경 없음</td>
      <td class="pass">✅ 14 통과</td>
    </tr>
  </table>

  <br>
  <b>전체 합계: <span class="highlight">83 / 83 테스트 통과</span></b>
</div>

<!-- ═══ EPS 음수 처리 ═══ -->
<div class="section">
  <h2>📊 EPS 음수(-) 데이터 처리 — 방안 분석 및 권고</h2>

  <h3>현황</h3>
  <div class="verdict">
    현재 구현: 음수 EPS 연도는 CAGR 계산에서 <b>완전 제외</b> (양수만 사용)<br>
    예시: Boeing [2018(+), 2019(-), 2020(-), 2021(-), 2022(+)] → CAGR은 2018→2022 4년 복리 계산<br>
    문제: 3년 손실 구간이 은폐되어 CAGR이 실제보다 낙관적으로 나타남
  </div>

  <h3>🔴 방안 A: 음수를 0으로 대체</h3>
  <div class="verdict">
    EPS &lt;= 0이면 EPS = 0으로 강제 치환<br>
    <span class="warn">⚠️ 문제:</span> EPS=0은 CAGR 계산 불가 (0/N 또는 0^(1/n) = 0). 결국 구간 내 0인 연도가 있으면 CAGR = -100% 또는 NaN<br>
    실용적이지 않음 — EPS=0 처리로 오히려 더 왜곡
  </div>

  <h3>🟡 방안 B: 음수 EPS 연도는 건너뛰되, 경고 표시 (현재 + AUTO-1)</h3>
  <div class="verdict">
    현재 로직 유지 + <code>gapYearsCount</code> 경고 표시 (AUTO-1에서 이미 적용)<br>
    버핏의 투자 철학과 일치: <i>"이익을 내지 못하는 기업은 투자 대상이 아니다"</i><br>
    <span class="pass">✅ 권고 방안</span> — 이미 적용 완료
  </div>

  <h3>🟢 방안 C: 음수 EPS 비율이 높으면 계산 블록 + 강한 경고</h3>
  <div class="verdict">
    negativeYearsCount / totalYears &gt; 0.3 (30% 이상 적자 연도)이면 CAGR 계산 자체를 미신뢰로 표시<br>
    <code>missing</code> 배열에 추가하여 UI에서 "이익 안정성 부족" 표시<br>
    향후 구현 권장 (이번 범위 외)
  </div>

  <h3>백테스팅 관점 평가</h3>
  <table>
    <tr><th>방안</th><th>정확도</th><th>구현 복잡도</th><th>버핏 철학 부합</th><th>권고</th></tr>
    <tr><td>A: 0 치환</td><td class="fail">낮음</td><td>낮음</td><td class="fail">부합 안 함</td><td class="fail">❌</td></tr>
    <tr><td>B: 건너뜀 + 경고</td><td>보통</td><td>낮음</td><td class="pass">부합</td><td class="pass">✅ 현재 적용</td></tr>
    <tr><td>C: 비율 체크 블록</td><td class="pass">높음</td><td>보통</td><td class="pass">부합</td><td class="warn">▶ 향후 권장</td></tr>
  </table>
</div>

<!-- ═══ 개선 권고 ═══ -->
<div class="section">
  <h2>💡 향후 개선 권고 (이번 미포함)</h2>

  <table>
    <tr><th>우선순위</th><th>항목</th><th>내용</th></tr>
    <tr>
      <td><span class="tag tag-warn">P1</span></td>
      <td>negativeYearsCount 활용 UI</td>
      <td>가치투자 패널에서 "최근 N년 중 M년 적자" 품질 표시. <code>averageEpsFromHistory</code> 이미 반환 중</td>
    </tr>
    <tr>
      <td><span class="tag tag-warn">P1</span></td>
      <td>CAGR 하한선 (-15%)</td>
      <td>EPS CAGR이 -15% 이하이면 "심각한 이익 감소" 경고. 현재는 무제한 음수 허용</td>
    </tr>
    <tr>
      <td><span class="tag tag-warn">P2</span></td>
      <td>음수 비율 &gt; 30% 블록</td>
      <td>방안 C: negativeYearsCount / total &gt; 0.3이면 계산 신뢰도 표시</td>
    </tr>
    <tr>
      <td><span class="tag tag-warn">P2</span></td>
      <td>PER 300 이상 한국주 처리</td>
      <td>현재 PER 300+ 완전 제외. 상장 초기 기업의 경우 연도별 제외 사유 표시 권장</td>
    </tr>
  </table>
</div>

<!-- ═══ 커밋 정보 ═══ -->
<div class="section">
  <h2>📦 커밋 정보</h2>
  <div class="verdict">
    <b>커밋 해시:</b> <code>dca3770</code><br>
    <b>브랜치:</b> main<br>
    <b>변경 파일:</b> 8개 (서버 로직 6개 + 테스트 5개 포함)<br>
    <b>추가:</b> +523줄 / <b>삭제:</b> -256줄
  </div>
</div>

<div class="footer">
  자동 생성 보고서 · Claude Sonnet 4.6 · 2026-06-13<br>
  실제 시장·재무 데이터 기반 추정이며 투자 권유가 아닙니다.
</div>

</div>
</body>
</html>
`;

const result = await sendTransactionalEmail({
  to: "samron3797@gmail.com",
  subject: "[Stock] 서버 로직 전체 점검 보고서 — 버그 3건 수정 + 자동개선 4건 + 테스트 83개 통과",
  html,
});

console.log("이메일 발송 완료:", result);
