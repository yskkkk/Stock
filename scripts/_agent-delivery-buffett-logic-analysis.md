[Stock] 버핏 로직 상세 분석 + 보유 종목 UI 반영

■ 개요
Stock 앱의 "버핏" 관련 로직은 두 축으로 나뉩니다.

1) 10년 기대수익·적정가 (Value Invest Bubble)
   - UI: 종목 행 클릭·「버핏」버튼 → 플로팅 말풍선
   - API: GET /api/stock/:symbol/value-invest-return
   - 계산: server/value-invest-return-model.js
   - 입력 조립: server/value-invest-return-input.js

2) 버핏식 내재가치 DCF (Financials 탭)
   - UI: 재무제표 탭 하단 BuffettIntrinsicPanel
   - API: GET /api/stock/:symbol/intrinsic-value
   - 계산: server/buffett-intrinsic-value.js
   - 입력 조립: server/buffett-intrinsic-input.js

공통 원칙: 가상 수치 없이 EPS·국채수익률·연간 재무·Yahoo/Naver 시세 등 실데이터만 사용.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 10년 기대수익·적정가 (말풍선)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[목적]
현재가 대비 10년 후 "총 회수액(매각+배당)"과 목표 수익률(기본 15%) 하에서의 적정 매수가를 산출.

[입력 데이터]
- 현재가: loadStockFundamentals → 보유 종목에서는 보유 현재가로 덮어씀
- EPS: 연간 EPS 이력 평균 우선 (value-invest-eps-history), 없으면 Trailing EPS
- 성장률: deriveValueInvestGrowth10y (value-invest-growth.js)
  ① 전년 대비 EPS 성장 (연간 실적 2개 이상)
  ② 없으면 Yahoo revenueGrowth (상한 25%)
  ③ 없으면 Forward÷Trailing (1년 추정, 10년 복리로 쓰지 않고 상한 25%)
- PER: 역사적 평균 PER (연도별 평균주가÷EPS, 일봉 캔들) 우선, 없으면 현재 Trailing PER
- 배당성향: 배당수익률×주가÷EPS, 없으면 0%
- 목표수익률: 고정 15% (DEFAULT_TARGET_RETURN)
- 기간: 10년

[핵심 공식] (calcValueInvestReturn)
매년 EPS_t = EPS_{t-1} × (1 + g)

10년차 EPS = EPS_0 × (1+g)^10
미래 주가 = 10년차 EPS × 평균 PER
10년 배당 합 = Σ(EPS_t × 배당성향)
총 회수액 = 미래 주가 + 10년 배당 합

CAGR = (총 회수액 ÷ 현재가)^(1/10) − 1

적정 매수가 = 총 회수액 ÷ (1 + 목표수익률)^10
  → 10년 후 총 회수액을 목표 CAGR로 할인한 "지금 사도 되는 가격"

[UI]
ValueInvestBubbleContext: 서버 입력값을 불러온 뒤 클라이언트에서 슬라이더·입력 수정 가능.
연도별 EPS·배당·PER적용 주가 투영 테이블, 공식 breakdown 표시.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 버핏식 내재가치 DCF (재무제표 탭)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[목적]
버핏식 "미래 EPS 할인" — 주당 내재가치와 25% 안전마진 매수가.

[할인율 r]
10년 국채 수익률 (fetchRiskFreeRate) — KR/US 시장별.

[단순 적정가]
적정가 = EPS ÷ r
(EPS만 있고 성장 추정 불가 시 폴백)

[10년 DCF — calcFullIntrinsic]
① 명시구간 (10년)
   매년 EPS_t = EPS_{t-1} × (1 + g10)
   PV_t = EPS_t ÷ (1+r)^t
   명시 PV 합 = Σ PV_t

② 잔여가치 (Gordon)
   EPS_{11} = EPS_{10} × (1 + g_terminal)
   Terminal = EPS_{11} ÷ (r − g_terminal)   ※ r > g_terminal 필수
   잔여 PV = Terminal ÷ (1+r)^10

③ 주당 내재가치
   = 명시 PV + 잔여 PV − 주당 순부채
   (순부채 = 재무제표 총부채−현금 ÷ 발행주식수, US 위주)

[성장률 g10]
- 연간 EPS 2개 이상 → 전년 대비 성장, 상한 25%
- 없으면 Forward÷Trailing, 상한 25%

[잔여성장 g_terminal]
- Yahoo revenueGrowth, min(매출성장, g10, 5%)

[판정 verdict]
- 현재가 ≤ 안전마진가(내재×75%): below_margin (저평가)
- 현재가 < 내재가치: below_intrinsic
- 내재 대비 −15% 이상 고평가: rich
- 그 외: near_fair

[품질 경고]
- EPS 변동계수 > 35% → 순환·예측 난이
- 성장률 > 35% → 일시적 회복 가능
- r−g < 3%p → 잔여가치 민감
- revenueGrowth 없음 → 잔여가치 생략


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 두 모델 비교
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| 항목 | Value Invest Bubble | Buffett DCF |
|------|---------------------|-------------|
| 관점 | 10년 총수익·목표수익률 매수가 | EPS 할인·내재가치 |
| PER | 역사적 평균 PER로 미래가 | 사용 안 함 |
| 배당 | 10년 누적 배당 포함 | 미포함 |
| 할인 | 목표 15% CAGR 역산 | 국채수익률 r |
| 잔여가치 | 없음 (10년 후 PER×EPS) | Gordon terminal |
| 부채 | 미차감 | 주당 순부채 차감 |
| UI | 말풍선(빠른 조회) | 재무제표 탭(상세) |


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 이번 UI 변경 — 보유 종목에서 버핏
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[변경]
- HoldingBuffettButton 추가: kr/us 보유 종목 옆 「버핏」 pill 버튼
- LiveHoldingChartSymbol: 종목명 옆 버튼 (보유·거래·시뮬 테이블 공통)
- LiveAccountHoldingsTossCards: 토스 카드 헤더 meta 영역에 버튼

[동작]
버튼 클릭 → ValueInvestBubble (10년 기대수익 말풍선)
보유 currentPrice를 API에 전달해 실시간 평가 기준 계산.

[미적용]
- crypto(빗썸): EPS·PER 없음 → 버튼 숨김
- 좌측 레일 dot 요약: 공간 제약으로 미포함 (전체 보유 테이블·카드에서 사용)

[파일]
- src/components/HoldingBuffettButton.tsx (신규)
- src/lib/valueInvestBubbleTarget.ts (holdingToValueInvestTarget)
- src/components/LiveTradeHoldingDisplay.tsx
- src/components/LiveAccountHoldingsTossCards.tsx
- src/ui-toss.css (.live-holding-buffett-btn)

[사용법]
실거래·거래내역·시뮬 보유 표에서 종목명 옆 「버핏」 클릭.
재무제표 탭 전체 DCF는 기존처럼 제무재표 탭 또는 보관함/실적 말풍선의 「제무재표」→ 하단 버핏식 내재가치 섹션.
