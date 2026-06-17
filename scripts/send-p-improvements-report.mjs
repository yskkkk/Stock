import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail } from "../server/email-sender.js";
loadEnvFile();

const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Apple SD Gothic Neo', sans-serif; background: #0f1117; color: #e2e8f0; margin: 0; padding: 0; }
  .wrap { max-width: 800px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 21px; color: #60a5fa; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
  h2 { font-size: 15px; color: #93c5fd; margin: 24px 0 8px; }
  .section { background: #1e2132; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; border: 1px solid #2d3561; }
  .tag { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-right: 6px; }
  .tag-feat { background: #14532d; color: #86efac; }
  .tag-fix { background: #7f1d1d; color: #fca5a5; }
  .tag-test { background: #3b1f6e; color: #c4b5fd; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { background: #1e3a5f; color: #93c5fd; padding: 7px 11px; text-align: left; }
  td { padding: 7px 11px; border-bottom: 1px solid #2d3561; }
  .pass { color: #4ade80; font-weight: 700; }
  code { background: #151a2d; padding: 2px 7px; border-radius: 4px; font-size: 12px; color: #a5f3fc; }
  ul { margin: 6px 0; padding-left: 18px; }
  li { margin: 4px 0; line-height: 1.6; }
  .footer { margin-top: 32px; font-size: 12px; color: #4b5563; text-align: center; }
</style>
</head>
<body>
<div class="wrap">

<h1>📋 P 전체 개선 + 방안 C 완료 보고서 — 2026-06-13</h1>

<div class="section">
  <h2>✅ 구현 완료 항목</h2>
  <table>
    <tr><th>항목</th><th>구분</th><th>내용</th><th>결과</th></tr>
    <tr>
      <td>방안 C — 이익 안정성 블록</td>
      <td><span class="tag tag-feat">P2</span></td>
      <td>EPS 이력 중 음수 비율 &gt; 30% + 5년 이상 데이터 → missing에 "이익 안정성 부족 — N년 중 M년 적자 (X%)" 추가</td>
      <td class="pass">✅ 완료</td>
    </tr>
    <tr>
      <td>PER 500 상한 + 고PER 경고</td>
      <td><span class="tag tag-feat">P2</span></td>
      <td>
        per &lt; 300 → per &lt; 500 (한국 성장주 300~499 포함)<br>
        역사적 평균 PER &gt; 200 → warnings에 "고PER 구간, 이익 성장 둔화 시 급락 리스크" 경고
      </td>
      <td class="pass">✅ 완료</td>
    </tr>
    <tr>
      <td>CAGR -15% 하한 경고</td>
      <td><span class="tag tag-feat">P1</span></td>
      <td>EPS CAGR &lt; -15% → "심각한 이익 감소 구간" 경고 (구: -40% 임계치)</td>
      <td class="pass">✅ 완료</td>
    </tr>
    <tr>
      <td>negativeEpsCount · totalEpsYears UI 노출</td>
      <td><span class="tag tag-feat">P1</span></td>
      <td><code>loadValueInvestReturn</code> 반환값에 <code>negativeEpsCount</code>, <code>totalEpsYears</code> 추가 — UI에서 "10년 중 3년 적자" 표시 가능</td>
      <td class="pass">✅ 완료</td>
    </tr>
  </table>
</div>

<div class="section">
  <h2>🔧 구현 세부</h2>

  <h2 style="font-size:13px;color:#bfdbfe;">방안 C — 이익 안정성</h2>
  <ul>
    <li><code>loadAnnualEpsHistory</code> 반환 타입 변경: <code>{ series, negativeCount }</code> — 적자 연도 카운트 추적</li>
    <li><code>buildValueInvestInputsFromFundamentals</code>: <code>opts.negativeEpsCount</code> + 인라인 음수 EPS 합산</li>
    <li>조건: <code>totalYears >= 5 &amp;&amp; negativeRatio > 30%</code> → <code>missing</code> 배열에 추가</li>
    <li><code>loadValueInvestReturn</code>: negativeCount 수집 후 전달</li>
  </ul>

  <h2 style="font-size:13px;color:#bfdbfe;">PER 처리 개선</h2>
  <ul>
    <li><code>computeHistoricalAveragePer</code>: <code>per &lt; 500</code> (구: 300) — 한국 고성장주 PER 300~499 이제 포함</li>
    <li>반환값에 <code>highPerWarning: boolean</code> 추가 (avg &gt; 200 시 true)</li>
    <li>PER ≥ 500은 데이터 오류 또는 극단적 성장주로 제외 유지</li>
    <li>경고 문구: <code>"역사적 평균 PER Xx — 고PER 구간, 이익 성장 둔화 시 급락 리스크"</code></li>
  </ul>

  <h2 style="font-size:13px;color:#bfdbfe;">CAGR 하한</h2>
  <ul>
    <li>기존: <code>histGrowth &lt; -0.4</code> (40%) → "음수 성장 구간"</li>
    <li>변경: <code>histGrowth &lt; -0.15</code> (15%) → "심각한 이익 감소 구간"</li>
    <li>결과: 더 민감하게 이익 감소를 경고 (예: -20% CAGR이면 이제 경고 발생)</li>
  </ul>
</div>

<div class="section">
  <h2>🧪 테스트</h2>
  <table>
    <tr><th>파일</th><th>신규 케이스</th><th>결과</th></tr>
    <tr>
      <td><code>value-invest-per-history.test.js</code></td>
      <td>T16(방안 C 블록), T17(통과), T17b(데이터 부족), T18(고PER 경고), T19(경고 없음), T20(반환값) — 6개 신규</td>
      <td class="pass">✅ 22 통과</td>
    </tr>
    <tr>
      <td><code>value-invest-eps-us-fix.test.js</code></td>
      <td>vitest 마이그레이션 + 반환 구조 검증</td>
      <td class="pass">✅ 7 통과</td>
    </tr>
    <tr>
      <td>나머지 4파일</td>
      <td>기존 케이스 유지</td>
      <td class="pass">✅ 67 통과</td>
    </tr>
  </table>
  <br>
  <b>전체 6파일 96케이스 통과</b>
</div>

<div class="section">
  <h2>📦 커밋</h2>
  <ul>
    <li>해시: <code>852584e</code></li>
    <li>변경: 5파일 (+155 / -66)</li>
    <li>브랜치: main (push 완료)</li>
  </ul>
</div>

<div class="footer">자동 생성 · Claude Sonnet 4.6 · 2026-06-13</div>
</div>
</body>
</html>
`;

const result = await sendTransactionalEmail({
  to: "samron3797@gmail.com",
  subject: "[Stock] 방안 C + P 전체 개선 완료 — 이익 안정성·고PER·CAGR 하한 · 96테스트 통과",
  html,
});
console.log("이메일 발송 완료:", result);
