#!/usr/bin/env node
/**
 * 박스권 탐지 로직 현황 분석 → 이메일
 * node scripts/send-detection-analysis-email.mjs
 */
import { loadEnvFile } from "../server/load-env.js";
import { sendTransactionalEmail, isEmailSendingConfigured } from "../server/email-sender.js";

loadEnvFile();

const TO = "samron3797@gmail.com";
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const subject = `[YSTOCK] 박스권 탐지 로직 현황 분석 — 개선 포인트 정리 (${now})`;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${subject}</title>
<style>
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;line-height:1.75;color:#111;max-width:960px;margin:0 auto;padding:28px 18px;background:#f8fafc;}
h1{font-size:1.28em;color:#1e3a8a;border-bottom:3px solid #2563eb;padding-bottom:10px;margin-bottom:4px;}
h2{font-size:1.07em;color:#1e40af;border-left:4px solid #3b82f6;padding-left:10px;margin-top:32px;margin-bottom:8px;}
h3{font-size:.97em;color:#374151;margin-top:18px;margin-bottom:6px;}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:.88em;}
th{background:#1e40af;color:#fff;padding:9px 11px;text-align:left;}
th.C{text-align:center;}
td{padding:8px 11px;border-bottom:1px solid #e5e7eb;vertical-align:top;}
td.C{text-align:center;}
tr:hover td{background:#f0f4ff;}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px 22px;margin-bottom:22px;box-shadow:0 1px 4px rgba(0,0,0,.06);}
.ok   {background:#f0fdf4;border:1px solid #86efac;border-radius:7px;padding:11px 15px;margin:10px 0;}
.warn {background:#fffbeb;border:1px solid #fcd34d;border-radius:7px;padding:11px 15px;margin:10px 0;}
.bad  {background:#fef2f2;border:1px solid #fca5a5;border-radius:7px;padding:11px 15px;margin:10px 0;}
.hl   {background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:11px 15px;margin:10px 0;}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:.87em;font-family:monospace;}
pre{background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:.84em;line-height:1.6;margin:10px 0;}
.badge{display:inline-block;color:#fff;padding:2px 9px;border-radius:10px;font-size:.82em;font-weight:bold;}
.score{font-size:1.4em;font-weight:bold;}
ul li,ol li{margin:5px 0;}
.tag-good{background:#16a34a;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;}
.tag-warn{background:#d97706;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;}
.tag-bad {background:#dc2626;color:#fff;border-radius:4px;padding:1px 6px;font-size:.8em;}
.footer{color:#9ca3af;font-size:.82em;margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;}
.flow{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}
.flow-step{background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:8px 14px;font-size:.88em;min-width:120px;text-align:center;}
.flow-arrow{display:flex;align-items:center;color:#93c5fd;font-size:1.4em;}</style>
</head>
<body>

<h1>🔍 박스권 탐지 로직 현황 분석 보고서</h1>
<p style="color:#6b7280;font-size:.88em;">${now} · YSTOCK 박스권 자동매매 시스템 · <code>box-range-pro-core.js</code></p>

<!-- ① 전체 흐름 -->
<div class="section">
<h2>① 현재 탐지 파이프라인 전체 흐름</h2>
<div class="flow">
  <div class="flow-step">① 가격 범위 시드<br><small>고저 maxPct 이내</small></div>
  <div class="flow-arrow">→</div>
  <div class="flow-step">② 양방향 확장<br><small>expandRangeIdxPro</small></div>
  <div class="flow-arrow">→</div>
  <div class="flow-step">③ 경계 계산<br><small>88/12 퍼센타일</small></div>
  <div class="flow-arrow">→</div>
  <div class="flow-step">④ 중심 계산<br><small>VWAP / 중앙값</small></div>
  <div class="flow-arrow">→</div>
  <div class="flow-step">⑤ 거절 카운트<br><small>countRejections</small></div>
  <div class="flow-arrow">→</div>
  <div class="flow-step">⑥ 크기 필터<br><small>minPct / maxPct</small></div>
</div>

<h3>핵심 파라미터 (constants.js)</h3>
<table>
<tr><th>파라미터</th><th>값</th><th>역할</th></tr>
<tr><td><code>BOX_RANGE_PRO_BAND_HIGH_PCT</code></td><td>88</td><td>종가 88퍼센타일 → top 경계</td></tr>
<tr><td><code>BOX_RANGE_PRO_BAND_LOW_PCT</code></td><td>12</td><td>종가 12퍼센타일 → bottom 경계</td></tr>
<tr><td><code>BOX_RANGE_PRO_MIN_REJECTIONS</code></td><td>1</td><td>상·하단 각각 최소 거절 횟수</td></tr>
<tr><td><code>BOX_RANGE_TOUCH_THRESHOLD</code></td><td>0.16 (16%)</td><td>박스 높이 대비 "터치" 허용 오차</td></tr>
<tr><td><code>BOX_RANGE_PRO_REJECT_CLOSE_FRAC</code></td><td>0.4 (40%)</td><td>터치 후 종가가 TOUCH_THRESHOLD × 0.4 이내면 거절로 인정</td></tr>
<tr><td><code>BOX_RANGE_MAX_EXPAND_BARS</code></td><td>120봉</td><td>박스 최대 확장 범위</td></tr>
<tr><td><code>BOX_RANGE_EXPAND_EDGE_PCT</code></td><td>16%</td><td>확장 시 경계 패딩 (박스높이 × 16%)</td></tr>
<tr><td><code>BOX_RANGE_EXPAND_GAP_BARS</code></td><td>3봉</td><td>확장 중 허용 연속 이탈 봉 수</td></tr>
<tr><td><code>BOX_RANGE_MIN_BARS</code></td><td>10봉</td><td>박스 최소 봉 수</td></tr>
<tr><td><code>BOX_RANGE_MIN_PCT</code></td><td>1h:1% / 4h:3% / 1d:0%</td><td>박스 최소 높이</td></tr>
<tr><td><code>BOX_RANGE_MAX_PCT</code></td><td>1h:4% / 4h:6.5% / 1d:18%</td><td>박스 최대 높이</td></tr>
<tr><td><code>BOX_RANGE_PRO_SPLIT_MID_PCT</code></td><td>1h:38% / 4h:48% / 1d:58%</td><td>확장 중단 — 종가가 중심에서 반높이의 N% 초과 이탈 시 종료</td></tr>
</table>
</div>

<!-- ② 단계별 코드 분석 -->
<div class="section">
<h2>② 각 단계 상세 분석</h2>

<h3>Step 1 — 가격 범위 시드 수집 <code>detectBoxRangeProAt</code></h3>
<pre>// endIdx에서 과거로 역행하며 maxPct 이내 봉 수집
for (let i = 1; i <= lookback; i++) {
  const rangePct = ((maxVal - minVal) / minVal) * 100;
  if (rangePct > maxPct) break;  // 초과 시 즉시 종료
  startIdx = idx;
}</pre>
<div class="warn">
<strong>현재 방식:</strong> 고가·저가 전체 범위(%)로 박스 진입 여부를 판단합니다.<br>
→ 긴 꼬리(윅) 하나만 있어도 박스가 일찍 끊길 수 있습니다.<br>
→ 반대로 <em>완만하게 기울어진 채널</em>도 maxPct 안에 들어오면 "박스"로 인식됩니다.
</div>

<h3>Step 2 — 양방향 확장 <code>expandRangeIdxPro</code></h3>
<pre>// 각 봉이 (top+pad, bottom-pad) 안에 있고
// 종가가 중심에서 splitPct × 반높이 이내면 확장 허용
barInBand(bar, top, bot, pad) && barNearMid(bar, mid, top, bot, splitPct)</pre>
<div class="ok">
<strong>장점:</strong> 박스를 좌우 양방향으로 키워 실제 횡보 구간 전체를 잡습니다.<br>
<code>gapAllow=3</code>으로 일시적 이탈 봉(잡음) 3봉까지 허용합니다.
</div>
<div class="warn">
<strong>한계:</strong> "중심 근접" 조건(<code>barNearMid</code>)이 <em>종가 기준</em>이라,
고가·저가가 이미 경계 밖으로 나갔어도 종가가 중심 근처면 박스에 포함됩니다.
</div>

<h3>Step 3 — 경계 계산 <code>computeBoxFromSlice</code></h3>
<pre>// 종가 배열만 사용 (고가·저가 제외)
top    = percentile(closes, 88)
bottom = percentile(closes, 12)
mid    = VWAP (거래량 있으면) or typical 중앙값</pre>
<div class="bad">
<strong>핵심 취약점 ①:</strong> 종가 배열만 사용 → 고가·저가 윅 완전 무시<br>
실제 지지·저항은 장중 가격(고저)에서 발생하지만, 탐지는 종가 분포만 봅니다.
</div>
<div class="bad">
<strong>핵심 취약점 ②:</strong> 88/12 퍼센타일은 통계적 추정 → "실제 가격이 반복 막힌 레벨"이 아님<br>
e.g. 종가가 2,000~2,100 사이에 고르게 퍼져 있으면 top=2,092, bottom=2,008 → 어떤 레벨도 "실제 저항/지지"가 아님
</div>

<h3>Step 4 — 거절 카운트 <code>countRejections</code></h3>
<pre>// 상단 거절: high >= top - th  AND  close < mid
// 하단 거절: low  <= bottom + th  AND  close > mid
// th = boxHeight × 0.16 (16%)
if (c.high >= top - th && c.close < mid) topReject += 1;
if (c.low <= bottom + th && c.close > mid) bottomReject += 1;</pre>
<div class="ok">
<strong>장점:</strong> "가격이 경계를 건드렸다가 반대편으로 돌아왔는지" 확인 — 진짜 지지/저항 개념 반영
</div>
<div class="warn">
<strong>한계:</strong>
<ul>
<li>거절 횟수만 셈 — 강도(얼마나 강하게 튕겼는지) 미반영</li>
<li>거래량 무관 — 대량 거래로 막힌 거절 = 소량 거절과 동일 취급</li>
<li>현재 최소 1회 (<code>MIN_REJECTIONS=1</code>) — 상·하단 각각 1번만 막혀도 박스 인정</li>
</ul>
</div>
</div>

<!-- ③ 횡보 여부 판단 없음 -->
<div class="section">
<h2>③ 가장 큰 공백: 횡보(Sideways) 여부 판단 없음</h2>
<div class="bad">
현재 로직은 "가격이 일정 범위 안에 있는가"만 확인합니다.<br>
<strong>추세 중인 박스 vs 횡보 박스를 전혀 구분하지 못합니다.</strong>
</div>

<p>TradingView에 별도로 작성된 <code>pine-box-range-finder.pine</code>은 이 문제를 해결하고 있습니다:</p>
<table>
<tr><th>지표</th><th>기준</th><th>역할</th><th>JS 구현?</th></tr>
<tr><td><strong>ADX</strong> (방향성 지수)</td><td>≤ 22</td><td>추세 강도 낮을 때만 박스 인정</td><td class="C"><span class="tag-bad">없음</span></td></tr>
<tr><td><strong>ER</strong> (효율비)</td><td>≤ 0.38</td><td>가격이 왔다갔다(chop) 하는지 확인</td><td class="C"><span class="tag-bad">없음</span></td></tr>
<tr><td><strong>폭 퍼센타일</strong></td><td>≤ 28%</td><td>최근 대비 특별히 좁은 구간인가</td><td class="C"><span class="tag-bad">없음</span></td></tr>
<tr><td><strong>ATR 이탈</strong></td><td>close > top + ATR×0.35</td><td>진짜 이탈인지 구분</td><td class="C"><span class="tag-warn">일부</span></td></tr>
</table>

<h3>효율비 (ER, Efficiency Ratio) 설명</h3>
<pre>ER = |close[0] - close[n]| / sum(|close[i] - close[i-1]|, n)

예시:
  - 추세 구간: 10봉 동안 100→150 직선 상승 → ER ≈ 1.0 (고효율)
  - 횡보 구간: 10봉 동안 100→99→101→100→102... → ER ≈ 0.1 (저효율)
  - ER < 0.3~0.4이면 "진짜 횡보"로 판단</pre>
<div class="hl">
ER만 추가해도 "상승/하락 중간에 잠시 쉬어가는 구간"이 박스로 잡히는 문제를 크게 줄일 수 있습니다.
</div>
</div>

<!-- ④ 중심(mid) 정확도 -->
<div class="section">
<h2>④ 중심가(mid) 정확도 — VWAP vs 거래량 프로파일</h2>
<table>
<tr><th>방식</th><th>현재</th><th>개선안</th></tr>
<tr>
  <td><strong>사용 데이터</strong></td>
  <td>박스 구간 전체 VWAP<br><small>(모든 봉 평균)</small></td>
  <td>거래량 프로파일 POC<br><small>(가격대별 거래량 합산 → 최고 구간)</small></td>
</tr>
<tr>
  <td><strong>의미</strong></td>
  <td>"평균적으로 어디서 거래됐나"</td>
  <td>"가장 많이 거래된 가격대는 어디인가"</td>
</tr>
<tr>
  <td><strong>지지/저항</strong></td>
  <td>박스 중간 어딘가</td>
  <td>실제 수급이 몰린 가격 = 진짜 균형점</td>
</tr>
<tr>
  <td><strong>단점</strong></td>
  <td>긴 꼬리 봉에 왜곡 가능</td>
  <td>버킷 수, 해상도 설계 필요</td>
</tr>
</table>

<h3>거래량 프로파일 POC 계산 예시</h3>
<pre>function computePOC(candles, leftIdx, rightIdx, buckets = 50) {
  const prices = candles.slice(leftIdx, rightIdx + 1);
  const minP = Math.min(...prices.map(c => c.low));
  const maxP = Math.max(...prices.map(c => c.high));
  const step = (maxP - minP) / buckets;
  const vol = new Array(buckets).fill(0);

  for (const c of prices) {
    const tp = (c.high + c.low + c.close) / 3;
    const bucket = Math.min(Math.floor((tp - minP) / step), buckets - 1);
    vol[bucket] += c.volume;
  }

  const maxBucket = vol.indexOf(Math.max(...vol));
  return minP + (maxBucket + 0.5) * step;  // POC
}</pre>
</div>

<!-- ⑤ 박스 품질 종합 평가 -->
<div class="section">
<h2>⑤ 현재 탐지 로직 종합 평가</h2>
<table>
<tr><th>항목</th><th class="C">현재 점수</th><th>설명</th></tr>
<tr>
  <td>횡보 여부 확인</td>
  <td class="C"><span class="score" style="color:#dc2626">2/10</span></td>
  <td>가격 범위만 봄 — ADX/ER 없음. 추세 중 짧은 쉬어가기도 박스로 잡힘</td>
</tr>
<tr>
  <td>경계 정확도 (top/bottom)</td>
  <td class="C"><span class="score" style="color:#d97706">5/10</span></td>
  <td>88/12 종가 퍼센타일. 고저 윅 무시. "통계적 경계" ≠ "실제 저항"</td>
</tr>
<tr>
  <td>중심가 정확도 (mid)</td>
  <td class="C"><span class="score" style="color:#d97706">6/10</span></td>
  <td>VWAP은 합리적. 다만 POC보다 지지/저항 의미 약함</td>
</tr>
<tr>
  <td>거절(반등) 품질</td>
  <td class="C"><span class="score" style="color:#d97706">5/10</span></td>
  <td>횟수 카운트는 좋음. 강도·거래량 미반영. 최소 1회라 너무 관대</td>
</tr>
<tr>
  <td>노이즈 필터링</td>
  <td class="C"><span class="score" style="color:#dc2626">3/10</span></td>
  <td>maxPct·minPct만 있음. 슬기로운 ATR 기반 이탈 필터 없음</td>
</tr>
<tr>
  <td>구현 안정성</td>
  <td class="C"><span class="score" style="color:#16a34a">8/10</span></td>
  <td>SSOT 구조, 테스트 있음, Pine과 동기화됨. 실전 검증 완료</td>
</tr>
</table>
</div>

<!-- ⑥ 개선 우선순위 -->
<div class="section">
<h2>⑥ 개선 우선순위 — 수익률 임팩트 순</h2>
<table>
<tr><th>#</th><th>개선 항목</th><th>기대 임팩트</th><th>구현 난이도</th><th>설명</th></tr>
<tr style="background:#fef9c3;">
  <td><strong>A</strong></td>
  <td><strong>ER (효율비) 필터 추가</strong></td>
  <td><span class="tag-good">매우 높음</span></td>
  <td>낮음 (15줄)</td>
  <td>추세 중 쉬어가기 박스 제거 → 박스 수 30~40% 감소, 승률 크게 개선 예상</td>
</tr>
<tr>
  <td><strong>B</strong></td>
  <td><strong>고저 윅 기반 경계 재계산</strong></td>
  <td><span class="tag-good">높음</span></td>
  <td>낮음 (10줄)</td>
  <td>top = percentile(highs, 88), bottom = percentile(lows, 12) → 실제 윅 포함</td>
</tr>
<tr>
  <td><strong>C</strong></td>
  <td><strong>거래량 프로파일 POC (mid 교체)</strong></td>
  <td><span class="tag-warn">중간</span></td>
  <td>중간 (40줄)</td>
  <td>mid = VWAP → POC (최고 거래량 가격대). 진입/SL 기준 개선</td>
</tr>
<tr>
  <td><strong>D</strong></td>
  <td><strong>거절 강도 스코어링</strong></td>
  <td><span class="tag-warn">중간</span></td>
  <td>낮음 (20줄)</td>
  <td>횟수 → 점수 (거래량×되돌림 거리). 최소 거절 기준 높이기</td>
</tr>
<tr>
  <td><strong>E</strong></td>
  <td><strong>ADX 필터</strong></td>
  <td><span class="tag-warn">중간</span></td>
  <td>낮음 (10줄)</td>
  <td>ADX(14) &lt; 25이면 박스 후보. Pine Finder에 이미 구현됨 — JS 이식만 필요</td>
</tr>
<tr>
  <td><strong>F</strong></td>
  <td><strong>박스 상단/하단 "평탄도" 검증</strong></td>
  <td><span class="tag-warn">중간</span></td>
  <td>중간 (30줄)</td>
  <td>실제 저항은 반복 막힌 가격이 좁은 범위에 몰려 있어야 함 (클러스터 분석)</td>
</tr>
</table>

<div class="hl">
<strong>추천 순서:</strong> A (ER 필터) → B (윅 기반 경계) → D (거절 강도) 순으로 적용 후 백테스팅 재측정<br>
셋 다 적용 시 <em>박스 수는 줄지만 품질 높은 박스만 남아 승률 및 기대수익 상승</em> 기대
</div>
</div>

<!-- ⑦ Pine Finder vs JS 비교 -->
<div class="section">
<h2>⑦ Pine Finder vs JS PRO 비교</h2>
<p><code>scripts/pine-box-range-finder.pine</code>에는 이미 고급 필터가 구현되어 있습니다.</p>
<table>
<tr><th>기능</th><th class="C">Pine Finder</th><th class="C">JS PRO (현재)</th></tr>
<tr><td>고저 범위 필터</td><td class="C">✓ maxBoxPct</td><td class="C">✓ MAX_PCT</td></tr>
<tr><td>최소 봉 수</td><td class="C">✓ minBoxBars</td><td class="C">✓ MIN_BARS</td></tr>
<tr><td>ATR 이탈 감지</td><td class="C">✓ atr × breakAtr</td><td class="C">△ maxPct만</td></tr>
<tr><td>ADX (추세 강도)</td><td class="C" style="color:#15803d"><strong>✓ ≤22</strong></td><td class="C" style="color:#dc2626"><strong>✗ 없음</strong></td></tr>
<tr><td>ER (효율비)</td><td class="C" style="color:#15803d"><strong>✓ ≤0.38</strong></td><td class="C" style="color:#dc2626"><strong>✗ 없음</strong></td></tr>
<tr><td>폭 퍼센타일 랭크</td><td class="C" style="color:#15803d"><strong>✓ ≤28%</strong></td><td class="C" style="color:#dc2626"><strong>✗ 없음</strong></td></tr>
<tr><td>88/12 종가 경계</td><td class="C">✗</td><td class="C">✓ 더 정밀</td></tr>
<tr><td>거절(반등) 카운트</td><td class="C">✗</td><td class="C">✓ 강점</td></tr>
<tr><td>VWAP 중심</td><td class="C">✗ 단순 중앙</td><td class="C">✓ 더 정밀</td></tr>
<tr><td>양방향 확장</td><td class="C">✗</td><td class="C">✓ expandRangeIdxPro</td></tr>
<tr><td>박스 병합</td><td class="C">✗</td><td class="C">✓ shouldMergeProBoxes</td></tr>
</table>
<div class="hl">
<strong>최적 방향:</strong> Pine Finder의 ADX + ER + 폭 퍼센타일을 JS PRO에 이식하면<br>
"추세 필터가 있는 정밀 경계 + 거절 확인" 조합이 완성됩니다.
</div>
</div>

<!-- ⑧ 다음 액션 -->
<div class="section">
<h2>⑧ 권고 — 다음 단계</h2>
<ol>
  <li><strong>ER 필터 백테스팅 먼저:</strong> 코드 수정 전에, 현재 백테스팅 데이터에서 ER < 0.35인 박스만 걸러서 수익률 변화 측정 → 임팩트 확인 후 구현 결정</li>
  <li><strong>윅 기반 경계 A/B 테스트:</strong> 현재 (종가 퍼센타일) vs 개선 (고저 퍼센타일) 두 방식 동시 백테스팅</li>
  <li><strong>Pine Finder ER·ADX JS 이식:</strong> 검증 완료 후 <code>box-range-pro-core.js</code>에 추가 (탐지 SSOT 유지)</li>
  <li><strong>재백테스팅:</strong> BTC·ETH·SOL + 주식 7개 × 1h·1d 재측정으로 개선 전/후 비교</li>
</ol>
<div class="warn">
<strong>주의:</strong> 필터를 강화할수록 박스 수는 줄어듭니다.
박스가 너무 적으면 거래 기회 손실이 생기므로,
<em>박스 수 vs 승률 트레이드오프</em>를 백테스팅으로 반드시 검증해야 합니다.
</div>
</div>

<div class="footer">
YSTOCK 박스권 탐지 로직 분석 · ${now}<br>
분석 파일: <code>server/box-range/box-range-pro-core.js</code> · <code>server/box-range/constants.js</code> · <code>scripts/pine-box-range-finder.pine</code>
</div>

</body>
</html>`;

const text = `[YSTOCK] 박스권 탐지 로직 현황 분석 (${now})

현재 방식 핵심: 88/12 종가 퍼센타일 경계 + VWAP 중심 + 거절 카운트

주요 취약점:
1. 횡보 여부 판단 없음 (ADX/ER 미구현) — 추세 중 쉬어가기 구간도 박스로 탐지됨
2. 경계가 "종가 통계" — 실제 고저 윅(지지/저항) 미반영
3. 거절 강도·거래량 미반영 — 횟수만 카운트

개선 우선순위:
A. ER 필터 추가 (효율비 < 0.35) — 구현 쉽고 임팩트 최대
B. 고저 윅 기반 경계 재계산 — top/bottom 신뢰도 향상
C. 거래량 프로파일 POC (mid 교체) — 진짜 균형점 탐색

Pine Finder (scripts/pine-box-range-finder.pine)에 ADX+ER 필터가 이미 구현됨.
JS PRO에 이식 시 "추세 필터 + 정밀 경계 + 거절 확인" 조합 완성.

— ${now}`;

if (!isEmailSendingConfigured()) {
  console.error("SMTP 미설정");
  process.exit(1);
}

console.log("이메일 전송 중...");
await sendTransactionalEmail({ to: TO, subject, text, html });
console.log(`✓ 전송 완료 → ${TO}`);
